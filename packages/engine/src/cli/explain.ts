import { gatherAll } from "../evidence/registry.js";
import type { LoadedCorpus } from "../loader/corpus.js";
import { loadDefaultCorpus } from "../loader/corpus.js";
import { score } from "../scorer/index.js";
import type {
  Band,
  DimensionAssignment,
  DimensionRecipe,
  Probe,
  Reading,
  ScoreConfig,
} from "../sdk/types.js";
import { errorMessage } from "../util/error-message.js";

export type ExplainOptions = {
  id: string;
  run?: boolean;
  cwd?: string;
  noCache?: boolean;
  judgeTransport?: "api" | "cli";
};

export async function explain(opts: ExplainOptions): Promise<{ stdout: string; exitCode: number }> {
  const corpus = await loadDefaultCorpus();

  const probe = corpus.probes.find((p) => p.id === opts.id);
  if (probe) {
    let trace: string[] = [];
    if (opts.run) trace = await runAndTrace(probe, opts);
    return { stdout: explainProbe(probe, corpus, trace), exitCode: 0 };
  }

  const dimension = corpus.dimensions.find((d) => d.id === opts.id);
  if (dimension) {
    return { stdout: explainDimension(dimension, corpus), exitCode: 0 };
  }

  const ids = [...corpus.probes.map((p) => p.id), ...corpus.dimensions.map((d) => d.id)].sort();
  return {
    stdout: `repofit: no probe or dimension '${opts.id}' in corpus '${corpus.name}'.\nKnown ids:\n  ${ids.join("\n  ")}\n`,
    exitCode: 2,
  };
}

async function runAndTrace(probe: Probe, opts: ExplainOptions): Promise<string[]> {
  const cwd = opts.cwd ?? process.cwd();
  try {
    const evidence = await gatherAll({
      cwd,
      judge: { noCache: opts.noCache, transport: opts.judgeTransport },
    });
    const reading = await probe.detect(evidence);
    return traceReadingAndScore(reading, probe.score);
  } catch (err) {
    return [`(failed to run: ${errorMessage(err)})`];
  }
}

function traceReadingAndScore(reading: Reading, config: ScoreConfig): string[] {
  const lines: string[] = [];

  if (reading.kind === "na") {
    lines.push(`reading  na — ${reading.reason}`);
    lines.push("score    — (na probes drop from aggregation)");
    return lines;
  }

  if (reading.kind === "error") {
    lines.push(`reading  error — ${reading.error}`);
    lines.push("score    — (errors surface but don't score)");
    return lines;
  }

  lines.push(...formatReading(reading));
  lines.push("");
  lines.push(...formatDerivation(reading, config));
  return lines;
}

function formatReading(reading: Reading): string[] {
  switch (reading.kind) {
    case "predicate":
      return [`reading  predicate · value=${reading.value}`];
    case "count":
      return [`reading  count · value=${reading.value}`];
    case "magnitude":
      return [`reading  magnitude · value=${reading.value} ${reading.unit}`];
    case "inventory": {
      const counts = countSeverities(reading.items);
      return [
        `reading  inventory · ${reading.items.length} items (${formatCounts(counts)})`,
        ...reading.items
          .slice(0, 5)
          .map((it) => `         · [${it.severity}] ${it.location.path}: ${it.message}`),
        ...(reading.items.length > 5 ? [`         · …${reading.items.length - 5} more`] : []),
      ];
    }
    case "distribution":
      return [
        `reading  distribution · ${reading.samples.length} samples (min=${Math.min(...reading.samples)}, max=${Math.max(...reading.samples)})`,
      ];
    case "judge":
      return [
        `reading  judge · score=${reading.score}, model=${reading.model}`,
        ...Object.entries(reading.perCriterion).map(
          ([id, s]) => `         · ${id.padEnd(24)} ${s}`,
        ),
        "",
        "rationale",
        ...indent(wrap(reading.rationale, 68), "  "),
      ];
    default:
      return [];
  }
}

function formatDerivation(reading: Reading, config: ScoreConfig): string[] {
  let computed: number | null;
  try {
    computed = score(reading, config);
  } catch (err) {
    return [`score    (scorer error: ${errorMessage(err)})`];
  }

  if (config.kind === "predicate" && reading.kind === "predicate") {
    const truth = reading.value ? 100 : 0;
    const flipped = config.direction === "positive" ? truth : 100 - truth;
    return [
      `score    ${flipped}`,
      `         direction=${config.direction}, value=${reading.value} → ${flipped}`,
    ];
  }

  if ((config.kind === "count" || config.kind === "magnitude") && reading.kind === config.kind) {
    const value = reading.value;
    const band = matchedBand(value, config.bands);
    return [`score    ${computed}`, `         value=${value} → ${describeBand(band)}`];
  }

  if (config.kind === "inventory" && reading.kind === "inventory") {
    const total = reading.items.reduce(
      (sum, it) => sum + (config.severityWeights[it.severity] ?? 0),
      0,
    );
    const band = matchedBand(total, config.bands);
    return [
      `score    ${computed}`,
      `         severity-weighted total=${total} → ${describeBand(band)}`,
    ];
  }

  if (config.kind === "distribution" && reading.kind === "distribution") {
    return [
      `score    ${computed}`,
      `         stat=${config.stat} over ${reading.samples.length} samples → ${computed}`,
    ];
  }

  if (config.kind === "judge" && reading.kind === "judge") {
    return [`score    ${computed}  (judge score passes through)`];
  }

  return [`score    ${computed}`];
}

function matchedBand(value: number, bands: Band[]): Band {
  for (const band of bands) {
    if (band.upTo === undefined) return band;
    if (value <= band.upTo) return band;
  }
  return bands[bands.length - 1] as Band;
}

function describeBand(band: Band): string {
  const range = band.upTo === undefined ? "default" : `≤ ${band.upTo}`;
  return `band (${range}) → ${band.score}`;
}

function countSeverities(items: ReadonlyArray<{ severity: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) out[it.severity] = (out[it.severity] ?? 0) + 1;
  return out;
}

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([sev, n]) => `${sev}=${n}`)
    .join(", ");
}

function explainProbe(probe: Probe, corpus: LoadedCorpus, trace: string[]): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`Probe       ${probe.id}  v${probe.version}`);
  lines.push(`Corpus      ${corpus.name}@${corpus.version}`);
  lines.push(`Tier        ${probe.tier}  ·  Reading type: ${probe.score.kind}`);
  lines.push(`Dimensions  ${formatAssignments(probe.dimensions)}`);
  lines.push("");
  lines.push("Rationale");
  lines.push(...indent(wrap(probe.rationale, 70), "  "));
  lines.push("");
  lines.push("Scoring");
  lines.push(...indent(formatScoring(probe.score), "  "));
  if (probe.remediation) {
    lines.push("");
    lines.push("How to fix");
    lines.push(...indent(wrap(probe.remediation, 70), "  "));
  }
  lines.push("");
  lines.push(`Evidence consumed`);
  lines.push(`  ${probe.evidence.join(", ")}`);
  if (trace.length > 0) {
    lines.push("");
    lines.push("Run on this repo");
    lines.push(...indent(trace, "  "));
  }
  if (probe.fixtures.length > 0) {
    lines.push("");
    lines.push(`Fixtures (${probe.fixtures.length})`);
    for (const f of probe.fixtures) {
      const expected = f.expect.score === null ? "—" : String(f.expect.score);
      lines.push(`  ${f.name.padEnd(20)}  expect score: ${expected}`);
    }
  }
  if (trace.length === 0) {
    lines.push("");
    lines.push("To run against this repo");
    lines.push(`  repofit explain ${probe.id} --run`);
  }
  lines.push("");
  return lines.join("\n");
}

function explainDimension(dim: DimensionRecipe, corpus: LoadedCorpus): string {
  const overrides = new Map(dim.overrides?.map((o) => [o.probeId, o.weight] as const));
  const contributing = corpus.probes
    .map((p) => {
      const assignment = p.dimensions.find((d) => d.id === dim.id);
      if (!assignment) return null;
      const weight = overrides.get(p.id) ?? assignment.weight;
      return { probe: p, defaultWeight: assignment.weight, weight };
    })
    .filter((x): x is { probe: Probe; defaultWeight: number; weight: number } => x !== null)
    .sort((a, b) => a.probe.id.localeCompare(b.probe.id));

  const lines: string[] = [];
  lines.push("");
  lines.push(`Dimension   ${dim.name}  (id: ${dim.id})`);
  lines.push(`Description ${dim.description}`);
  lines.push(`Gating      ${dim.gating ? "yes" : "no"}`);
  lines.push("");
  lines.push(`Contributing probes (${contributing.length})`);
  for (const c of contributing) {
    const weightText =
      c.weight === c.defaultWeight
        ? `weight ${c.weight}`
        : `weight ${c.weight} (default ${c.defaultWeight})`;
    lines.push(`  ${c.probe.id.padEnd(36)}  ${weightText}`);
  }
  lines.push("");
  lines.push("Aggregation");
  lines.push("  Weighted average; n/a probes dropped; error probes surface but don't score.");
  lines.push("");
  return lines.join("\n");
}

function formatAssignments(assignments: DimensionAssignment[]): string {
  return assignments.map((a) => `${a.id} (weight ${a.weight})`).join(", ");
}

function formatScoring(score: ScoreConfig): string[] {
  switch (score.kind) {
    case "predicate":
      return [`predicate, direction ${score.direction}`, "  true  → 100", "  false → 0"];
    case "count":
    case "magnitude":
      return [
        `${score.kind}, direction ${score.direction}`,
        ...score.bands.map(
          (b) => `  ${b.upTo === undefined ? "default" : `≤ ${b.upTo}`} → ${b.score}`,
        ),
      ];
    case "inventory":
      return [
        `inventory, severity-weighted`,
        ...Object.entries(score.severityWeights).map(([k, v]) => `  ${k}: ${v}`),
        ...score.bands.map(
          (b) => `  ${b.upTo === undefined ? "default" : `≤ ${b.upTo}`} → ${b.score}`,
        ),
      ];
    case "distribution":
      return [
        `distribution, stat ${score.stat}`,
        ...score.bands.map(
          (b) => `  ${b.upTo === undefined ? "default" : `≤ ${b.upTo}`} → ${b.score}`,
        ),
      ];
    case "judge":
      return ["judge (LLM-rated)", "  banded scores: 0, 20, 50, 80, 100 (snapped to nearest)"];
  }
}

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (line.length + word.length + 1 > width && line.length > 0) {
        out.push(line);
        line = word;
      } else {
        line = line.length === 0 ? word : `${line} ${word}`;
      }
    }
    if (line.length > 0) out.push(line);
  }
  return out;
}

function indent(lines: string[], prefix: string): string[] {
  return lines.map((l) => `${prefix}${l}`);
}
