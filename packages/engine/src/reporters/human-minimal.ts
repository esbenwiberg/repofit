import type { Aggregated } from "../aggregator/index.js";
import type { ProbeResult } from "../runner/tiered.js";
import type { Drift } from "../verdict/drift.js";
import type { Verdict } from "../verdict/index.js";

export type RenderInput = {
  aggregated: Aggregated;
  results: ProbeResult[];
  verdict: Verdict;
  drift: Drift;
  cost?: { executedMs: number };
};

export function renderHuman(input: RenderInput): string {
  const { aggregated, results, verdict, drift, cost } = input;
  const lines: string[] = [];

  lines.push("");
  lines.push(`repofit  ·  ${results.length} probe${results.length === 1 ? "" : "s"}`);
  lines.push("");

  for (const dim of aggregated.dimensions) {
    const scoreText = dim.score === null ? "  —  " : dim.score.toFixed(0).padStart(5, " ");
    const gating = dim.gating ? "  (gating)" : "";
    lines.push(`  ${scoreText}  ${dim.name}${gating}  ·  ${dim.probeCount} probe(s)`);
  }

  lines.push("");
  for (const r of results) {
    lines.push(`    ${readingVerdict(r)}  ${r.probe.id}`);
  }

  lines.push("");
  if (aggregated.fitness === null) {
    lines.push("  fitness  —  (no scored probes)");
  } else {
    lines.push(`  fitness  ${aggregated.fitness.toFixed(0)}`);
  }
  lines.push(`  gate     ${verdict.mode}  ·  ${verdict.pass ? "PASS" : "FAIL"}`);
  for (const reason of verdict.reasons) lines.push(`           ${reason}`);
  if (cost) lines.push(`  cost     executed tier ${(cost.executedMs / 1000).toFixed(1)}s`);

  if (drift.newProbes.length > 0) {
    lines.push("");
    lines.push(`  new probes (not yet in baseline): ${drift.newProbes.join(", ")}`);
  }
  if (drift.removedProbes.length > 0) {
    lines.push(`  stale baseline entries: ${drift.removedProbes.join(", ")}`);
  }
  for (const m of drift.corpusVersionMismatches) {
    lines.push(`  corpus version drift: ${m.package} baseline=${m.baseline} current=${m.current}`);
  }

  lines.push("");
  return lines.join("\n");
}

function readingVerdict(r: ProbeResult): string {
  switch (r.reading.kind) {
    case "predicate":
      return r.reading.value ? "PASS" : "FAIL";
    case "na":
      return " N/A";
    case "error":
      return " ERR";
    default:
      return r.score === null ? "  ?  " : `${r.score.toFixed(0)}`.padStart(4, " ");
  }
}
