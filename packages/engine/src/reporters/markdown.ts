import type { ProbeResult } from "../runner/tiered.js";
import { buildReport, type DimensionReport, type FitnessBlock, type ReportInput } from "./json.js";

export function renderMarkdown(input: ReportInput): string {
  const report = buildReport(input);
  const lines: string[] = [];

  lines.push(headline(report.verdict, report.fitness));
  lines.push("");
  lines.push(dimensionTable(report.dimensions));
  lines.push("");

  const attention = needsAttention(input.results);
  if (attention.length > 0) {
    lines.push(attentionSection(attention));
    lines.push("");
  }

  const footer = footerLine(report);
  if (footer) lines.push(footer);

  return `${lines.join("\n").trimEnd()}\n`;
}

function headline(verdict: "pass" | "fail" | "advisory", fitness: FitnessBlock): string {
  const verdictBadge =
    verdict === "pass" ? "**pass**" : verdict === "fail" ? "**fail**" : "**advisory**";
  const score = fitness.score === null ? "—" : `**${fitness.score}**`;
  const baseline =
    fitness.baseline === null ? "" : ` (was ${fitness.baseline}, ${signed(fitness.delta)})`;
  return `**repofit:** ${verdictBadge} · fitness ${score} / 100${baseline}`;
}

function dimensionTable(dims: Record<string, DimensionReport>): string {
  const rows = Object.entries(dims).map(([id, d]) => {
    const name = capitalize(id) + (d.gating ? " (gating)" : "");
    const score = d.score === null ? "—" : `${d.score}`;
    const delta = formatDelta(d);
    return `| ${name} | ${score} | ${delta} | ${d.probeCount} |`;
  });
  return ["| Dimension | Score | Δ | Probes |", "|---|---|---|---|", ...rows].join("\n");
}

function attentionSection(results: ProbeResult[]): string {
  const lines: string[] = [];
  lines.push(`<details>`);
  const noun = results.length === 1 ? "probe needs" : "probes need";
  lines.push(`<summary>${results.length} ${noun} attention</summary>`);
  lines.push("");
  for (const r of results) {
    const score = r.score === null ? "—" : `${r.score}`;
    const remediation = r.probe.remediation ? ` — ${oneLine(r.probe.remediation)}` : "";
    lines.push(`- \`${r.probe.id}\` (${score})${remediation}`);
  }
  lines.push("");
  lines.push(`</details>`);
  return lines.join("\n");
}

function footerLine(report: ReturnType<typeof buildReport>): string {
  const parts: string[] = [];
  if (report.drift.newProbes.length > 0) {
    const n = report.drift.newProbes.length;
    parts.push(`${n} new probe${n === 1 ? "" : "s"} since baseline`);
  }
  if (report.cost) {
    parts.push(`executed tier ${(report.cost.executedMs / 1000).toFixed(1)}s`);
  }
  if (report.commit) {
    parts.push(`commit ${report.commit.slice(0, 7)}`);
  }
  if (parts.length === 0) return "";
  return `<sub>${parts.join(" · ")}</sub>`;
}

function needsAttention(results: ProbeResult[]): ProbeResult[] {
  const out = results.filter((r) => {
    if (r.reading.kind === "na" || r.reading.kind === "error") return false;
    if (r.reading.kind === "predicate") return !r.reading.value;
    return r.score !== null && r.score < 100;
  });
  out.sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
  return out.slice(0, 8);
}

function formatDelta(d: DimensionReport): string {
  if (d.baseline === null && d.score !== null) return "new";
  if (d.delta === null) return "—";
  if (d.delta === 0) return "—";
  return signed(d.delta);
}

function signed(n: number | null): string {
  if (n === null || n === 0) return "—";
  return n > 0 ? `**+${n}**` : `**${n}**`;
}

function oneLine(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= 160) return trimmed;
  return `${trimmed.slice(0, 157)}...`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
