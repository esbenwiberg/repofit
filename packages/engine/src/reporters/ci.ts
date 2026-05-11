import { writeFile } from "node:fs/promises";
import type { ProbeResult } from "../runner/tiered.js";
import type { Severity } from "../sdk/types.js";
import { buildReport, type ReportInput } from "./json.js";

export type CiRenderInput = ReportInput & {
  artifactPath?: string;
  githubActions?: boolean;
};

export type CiRender = {
  stdout: string;
  annotations: string[];
  artifactWritten?: string;
};

export async function renderCi(input: CiRenderInput): Promise<CiRender> {
  const report = buildReport(input);
  const verdictText =
    report.verdict === "advisory" ? "ADVISORY" : report.verdict === "pass" ? "PASS" : "FAIL";
  const score = report.fitness.score ?? "—";
  const baseline = report.fitness.baseline;
  const baselineText = baseline === null ? "no baseline" : `baseline ${baseline}`;
  const deltaText = report.fitness.delta === null ? "" : `, ${signed(report.fitness.delta)}`;

  const costText = report.cost ? `  executed ${(report.cost.executedMs / 1000).toFixed(1)}s` : "";
  const stdout = `repofit: fitness ${score} (${baselineText}${deltaText})  ${report.config.gateMode}  ${verdictText}${costText}`;

  const annotations = input.githubActions ? githubAnnotations(input.results) : [];

  let artifactWritten: string | undefined;
  if (input.artifactPath) {
    await writeFile(input.artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    artifactWritten = input.artifactPath;
  }

  return { stdout, annotations, artifactWritten };
}

function githubAnnotations(results: ProbeResult[]): string[] {
  const out: string[] = [];
  for (const r of results) {
    if (r.reading.kind !== "inventory") continue;
    for (const item of r.reading.items) {
      out.push(annotationLine(r.probe.id, item.severity, item.location, item.message));
    }
  }
  return out;
}

function annotationLine(
  probeId: string,
  severity: Severity,
  location: { path: string; range?: { startLine: number; endLine?: number } },
  message: string,
): string {
  const level = severity === "error" ? "error" : "warning";
  const params: string[] = [`file=${escapeAnnotationParam(location.path)}`];
  if (location.range?.startLine !== undefined) params.push(`line=${location.range.startLine}`);
  if (location.range?.endLine !== undefined) params.push(`endLine=${location.range.endLine}`);
  return `::${level} ${params.join(",")}::${probeId}: ${escapeAnnotationData(message)}`;
}

function escapeAnnotationParam(value: string): string {
  return value
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A")
    .replace(/:/g, "%3A")
    .replace(/,/g, "%2C");
}

function escapeAnnotationData(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}
