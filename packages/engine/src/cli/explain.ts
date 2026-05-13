import type { LoadedCorpus } from "../loader/corpus.js";
import { loadDefaultCorpus } from "../loader/corpus.js";
import type { DimensionAssignment, DimensionRecipe, Probe, ScoreConfig } from "../sdk/types.js";

export type ExplainOptions = {
  id: string;
};

export async function explain(opts: ExplainOptions): Promise<{ stdout: string; exitCode: number }> {
  const corpus = await loadDefaultCorpus();

  const probe = corpus.probes.find((p) => p.id === opts.id);
  if (probe) {
    return { stdout: explainProbe(probe, corpus), exitCode: 0 };
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

function explainProbe(probe: Probe, corpus: LoadedCorpus): string {
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
  lines.push("");
  lines.push(`Evidence consumed`);
  lines.push(`  ${probe.evidence.join(", ")}`);
  if (probe.fixtures.length > 0) {
    lines.push("");
    lines.push(`Fixtures (${probe.fixtures.length})`);
    for (const f of probe.fixtures) {
      const expected = f.expect.score === null ? "—" : String(f.expect.score);
      lines.push(`  ${f.name.padEnd(20)}  expect score: ${expected}`);
    }
  }
  lines.push("");
  lines.push("To debug");
  lines.push(`  repofit check --probe ${probe.id}`);
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
