import type { Aggregated, DimensionResult } from "../aggregator/index.js";
import { VERSION } from "../index.js";
import type { CorpusPin, GateMode } from "../loader/config.js";
import type { LoadedCorpus } from "../loader/corpus.js";
import type { ProbeResult } from "../runner/tiered.js";
import type { Reading } from "../sdk/types.js";
import type { Drift } from "../verdict/drift.js";
import type { Verdict } from "../verdict/index.js";

export const REPORT_SCHEMA_VERSION = 1;

export type ReportInput = {
  cwd: string;
  commit?: string;
  corpus: LoadedCorpus;
  config: { gateMode: GateMode; include?: readonly string[] };
  aggregated: Aggregated;
  results: ProbeResult[];
  verdict: Verdict;
  drift: Drift;
  baseline: {
    fitness: number | null;
    dimensions: Record<string, number | null>;
    probes: Record<string, number | null>;
  } | null;
  ranAt?: string;
  cost?: { executedMs: number };
};

export type FitnessBlock = {
  score: number | null;
  baseline: number | null;
  delta: number | null;
};

export type DimensionReport = {
  score: number | null;
  baseline: number | null;
  delta: number | null;
  weight: number;
  gating: boolean;
  probeCount: number;
};

export type ProbeReport = {
  id: string;
  version: string;
  tier: string;
  reading: Reading;
  score: number | null;
  baseline: number | null;
  delta: number | null;
};

export type Report = {
  $schema: "https://repofit.dev/schema/report.v1.json";
  version: typeof REPORT_SCHEMA_VERSION;
  tool: { name: "repofit"; version: string };
  ranAt: string;
  commit: string | null;
  corpus: CorpusPin[];
  config: { gateMode: GateMode; include?: readonly string[] };
  fitness: FitnessBlock;
  verdict: "pass" | "fail" | "advisory";
  dimensions: Record<string, DimensionReport>;
  probes: ProbeReport[];
  drift: Drift;
  summary: { ran: number; pass: number; fail: number; na: number; error: number };
  cost?: { executedMs: number };
};

export function buildReport(input: ReportInput): Report {
  const baselineDims = input.baseline?.dimensions ?? {};
  const baselineProbes = input.baseline?.probes ?? {};

  const dimensions: Record<string, DimensionReport> = {};
  for (const d of input.aggregated.dimensions) {
    dimensions[d.id] = dimensionEntry(d, baselineDims[d.id] ?? null);
  }

  const probes: ProbeReport[] = input.results
    .map((r) => probeEntry(r, baselineProbes[r.probe.id] ?? null))
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    $schema: "https://repofit.dev/schema/report.v1.json",
    version: REPORT_SCHEMA_VERSION,
    tool: { name: "repofit", version: VERSION },
    ranAt: input.ranAt ?? new Date().toISOString(),
    commit: input.commit ?? null,
    corpus: [{ package: input.corpus.name, version: input.corpus.version }],
    config: input.config,
    fitness: fitnessBlock(input.aggregated.fitness, input.baseline?.fitness ?? null),
    verdict: verdictLabel(input.verdict),
    dimensions,
    probes,
    drift: input.drift,
    summary: summarize(input.results),
    ...(input.cost ? { cost: input.cost } : {}),
  };
}

function verdictLabel(v: Verdict): "pass" | "fail" | "advisory" {
  if (v.mode === "advisory") return "advisory";
  return v.pass ? "pass" : "fail";
}

function dimensionEntry(d: DimensionResult, baseline: number | null): DimensionReport {
  return {
    score: roundScore(d.score),
    baseline: roundScore(baseline),
    delta: deltaInt(d.score, baseline),
    weight: d.weight,
    gating: d.gating,
    probeCount: d.probeCount,
  };
}

function probeEntry(r: ProbeResult, baseline: number | null): ProbeReport {
  return {
    id: r.probe.id,
    version: r.probe.version,
    tier: r.probe.tier,
    reading: r.reading,
    score: roundScore(r.score),
    baseline: roundScore(baseline),
    delta: deltaInt(r.score, baseline),
  };
}

function fitnessBlock(score: number | null, baseline: number | null): FitnessBlock {
  return {
    score: roundScore(score),
    baseline: roundScore(baseline),
    delta: deltaInt(score, baseline),
  };
}

function summarize(results: ProbeResult[]): Report["summary"] {
  const summary = { ran: results.length, pass: 0, fail: 0, na: 0, error: 0 };
  for (const r of results) {
    switch (r.reading.kind) {
      case "na":
        summary.na += 1;
        break;
      case "error":
        summary.error += 1;
        break;
      case "predicate":
        if (r.reading.value) summary.pass += 1;
        else summary.fail += 1;
        break;
      default:
        if (r.score !== null && r.score >= 50) summary.pass += 1;
        else summary.fail += 1;
        break;
    }
  }
  return summary;
}

function roundScore(value: number | null): number | null {
  return value === null ? null : Math.round(value);
}

function deltaInt(current: number | null, baseline: number | null): number | null {
  if (current === null || baseline === null) return null;
  return Math.round(current) - Math.round(baseline);
}

export function renderJson(input: ReportInput): string {
  return `${JSON.stringify(buildReport(input), null, 2)}\n`;
}
