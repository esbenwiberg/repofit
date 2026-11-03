import type { Aggregated } from "../aggregator/index.js";
import type { ProbeResult } from "../runner/tiered.js";
import type { ToolchainStack } from "../sdk/types.js";
import type { Drift } from "../verdict/drift.js";
import type { Verdict } from "../verdict/index.js";

export type RenderInput = {
  aggregated: Aggregated;
  results: ProbeResult[];
  verdict: Verdict;
  drift: Drift;
  cost?: { executedMs: number };
  toolchain?: { stacks: ToolchainStack[]; primary: ToolchainStack | null };
};

export function renderHuman(input: RenderInput): string {
  const { aggregated, results, verdict, drift, cost, toolchain } = input;
  const lines: string[] = [];

  lines.push("");
  lines.push(`repofit  ·  ${results.length} probe${results.length === 1 ? "" : "s"}`);
  lines.push("");

  const stackBanner = renderStackBanner(toolchain, results);
  if (stackBanner) {
    lines.push(...stackBanner);
    lines.push("");
  }

  for (const dim of aggregated.dimensions) {
    const scoreText = dim.score === null ? "  —  " : dim.score.toFixed(0).padStart(5, " ");
    const gating = dim.gating ? "  (gating)" : "";
    lines.push(`  ${scoreText}  ${dim.name}${gating}  ·  ${dim.probeCount} probe(s)`);
  }

  lines.push("");
  for (const r of results) {
    lines.push(`    ${readingVerdict(r)}  ${r.probe.id}`);
  }

  const fixable = results.filter((r) => r.probe.remediation && needsAttention(r));
  if (fixable.length > 0) {
    lines.push("");
    lines.push("  How to fix");
    for (const r of fixable) {
      lines.push(`    ${r.probe.id}`);
      lines.push(`      ${r.probe.remediation}`);
    }
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

function needsAttention(r: ProbeResult): boolean {
  if (r.reading.kind === "na" || r.reading.kind === "error") return false;
  if (r.reading.kind === "predicate") return !r.reading.value;
  return r.score !== null && r.score < 100;
}

/**
 * When no supported stack was detected, list the toolchain-related n/a
 * probes and tell the user how to unblock them — either declare commands
 * in repofit.config.json, or load a corpus that supports their stack.
 */
function renderStackBanner(
  toolchain: RenderInput["toolchain"],
  results: ProbeResult[],
): string[] | null {
  if (!toolchain) return null;
  if (toolchain.primary !== null) return null;

  const skipped = results.filter(
    (r) =>
      r.reading.kind === "na" && /command|stack/.test((r.reading as { reason: string }).reason),
  );
  if (skipped.length === 0) return null;

  const probeList = skipped.map((r) => r.probe.id).join(", ");
  return [
    "  no supported stack detected (Node / Python / .NET / Go)",
    `  ${skipped.length} probe${skipped.length === 1 ? "" : "s"} skipped: ${probeList}`,
    "  declare commands in repofit.config.json#toolchain.commands, or load a",
    "  corpus that supports your stack (see authoring docs)",
  ];
}

function readingVerdict(r: ProbeResult): string {
  switch (r.reading.kind) {
    case "predicate":
      // The score already applies the probe's direction; the raw value does not.
      return r.score === null ? (r.reading.value ? "PASS" : "FAIL") : r.score > 0 ? "PASS" : "FAIL";
    case "na":
      return " N/A";
    case "error":
      return " ERR";
    default:
      return r.score === null ? "  ?  " : `${r.score.toFixed(0)}`.padStart(4, " ");
  }
}
