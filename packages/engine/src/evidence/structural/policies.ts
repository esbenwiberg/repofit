import type { Location } from "../../sdk/types.js";
import { safeRead } from "./indexer.js";
import type { Finding, Policy, PolicyRule, StructuralIndex } from "./types.js";

export const POLICY_PATH = "repofit.policy.json";
export function matches(value: string, glob: string): boolean {
  const escaped = glob
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\0")
    .replaceAll("*", "[^/]*")
    .replaceAll("\0", ".*");
  return new RegExp(`^${escaped}$`).test(value);
}
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((x) => typeof x === "string" && x.length > 0);
export function parsePolicy(text: string): Policy {
  const p = JSON.parse(text) as Policy;
  if (p.version !== 1 || !Array.isArray(p.rules) || p.rules.length > 256)
    throw new Error("policy requires version:1 and <=256 rules");
  const ids = new Set<string>();
  for (const r of p.rules) {
    if (
      !r ||
      typeof r.id !== "string" ||
      !r.id ||
      ids.has(r.id) ||
      !["restricted-call", "restricted-import", "module-boundary", "required-call"].includes(
        r.kind,
      ) ||
      !strings(r.scope) ||
      !r.scope.length ||
      typeof r.match !== "string" ||
      !r.match ||
      typeof r.rationale !== "string" ||
      !r.rationale.trim() ||
      (r.replacement !== undefined && typeof r.replacement !== "string") ||
      (r.allowed !== undefined && !strings(r.allowed)) ||
      (r.documentation !== undefined && !strings(r.documentation))
    )
      throw new Error("invalid or unsupported policy rule (id/kind/scope/match/rationale)");
    ids.add(r.id);
  }
  if (p.experiments !== undefined && (!Array.isArray(p.experiments) || p.experiments.length > 16))
    throw new Error("policy experiments must be an array of <=16 cases");
  const experimentIds = new Set<string>();
  for (const e of p.experiments ?? []) {
    if (
      !e.id ||
      typeof e.id !== "string" ||
      experimentIds.has(e.id) ||
      typeof e.expectedDiagnostic !== "string" ||
      !e.expectedDiagnostic.trim() ||
      !strings(e.argv) ||
      !e.argv.length ||
      e.argv.length > 64 ||
      !e.argv.some((a) => a.includes("{fixture}"))
    )
      throw new Error("experiment requires id and explicit argv with {fixture}");
    experimentIds.add(e.id);
    for (const f of [e.valid, e.invalid]) {
      if (
        !f ||
        typeof f.path !== "string" ||
        !/^[\w./-]+$/.test(f.path) ||
        f.path.split("/").includes("..") ||
        f.path.startsWith("/") ||
        typeof f.content !== "string" ||
        Buffer.byteLength(f.content) > 65536
      )
        throw new Error("experiment fixtures must be bounded relative files");
    }
    if (
      e.timeoutMs !== undefined &&
      (!Number.isFinite(e.timeoutMs) || e.timeoutMs < 1 || e.timeoutMs > 30000)
    )
      throw new Error("experiment timeout must be 1..30000ms");
  }
  return p;
}
export async function loadPolicy(cwd: string): Promise<{ policy?: Policy; unknowns: string[] }> {
  try {
    return { policy: parsePolicy(await safeRead(cwd, POLICY_PATH)), unknowns: [] };
  } catch (err) {
    return {
      unknowns: [
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? "No repository-declared policy; patterns are not correctness rules."
          : `Policy could not be assessed: ${String(err)}`,
      ],
    };
  }
}
function ruleLocation(rule: PolicyRule): Location {
  return { path: `${POLICY_PATH}#${rule.id}` };
}
export function assessPolicies(index: StructuralIndex, policy?: Policy): Finding[] {
  const findings: Finding[] = [];
  for (const rule of policy?.rules ?? []) {
    for (const file of Object.values(index.files)) {
      if (
        !["typescript", "csharp"].includes(file.adapter) ||
        !rule.scope.some((g) => matches(file.path, g)) ||
        rule.allowed?.some((g) => matches(file.path, g))
      )
        continue;
      const facts =
        rule.kind === "restricted-import" || rule.kind === "module-boundary"
          ? file.imports
          : file.symbols.flatMap((s) => s.calls);
      const violations = facts.filter((f) => matches(f.name, rule.match));
      if (rule.kind === "required-call") {
        // Syntactic absence is not semantic absence; only report an advisory gap.
        if (!violations.length)
          findings.push({
            kind: "candidate",
            confidence: "heuristic",
            severity: "info",
            ruleId: rule.id,
            location: { path: file.path },
            relatedLocations: [ruleLocation(rule)],
            message: `No lexical call matching ${rule.match} found for declared rule ${rule.id}; aliases/dynamic/framework behavior remain unknown. ${rule.rationale}`,
          });
        continue;
      }
      for (const v of new Map(violations.map((f) => [`${f.name}:${f.line}`, f])).values())
        findings.push({
          kind: "policy",
          confidence: "deterministic",
          severity: "warn",
          ruleId: rule.id,
          location: { path: file.path, range: { startLine: v.line } },
          relatedLocations: [
            ruleLocation(rule),
            ...(rule.documentation ?? []).map((path) => ({ path })),
          ],
          message: `Lexical ${rule.kind} rule ${rule.id} matches ${v.name}. ${rule.rationale}${rule.replacement ? ` Preferred replacement: ${rule.replacement}.` : ""} Name resolution is not established.`,
        });
    }
  }
  return findings;
}
const SUPPRESSIONS =
  /eslint-disable(?:-next-line|-line)?|@ts-(?:ignore|expect-error|nocheck)|#pragma\s+warning\s+disable|SuppressMessage|NOSONAR|istanbul\s+ignore|c8\s+ignore|coverage\s*[:=-]\s*(?:ignore|off)|noqa|type:\s*ignore|--no-verify|--ignore-scripts|continue-on-error|allow_failure|\|\|\s*true/g;
export function discoverBypasses(index: StructuralIndex, policy?: Policy): Finding[] {
  const out: Finding[] = [];
  for (const file of Object.values(index.files)) {
    const segments = [
      ...file.texts,
      ...file.symbols.map((s) => ({
        kind: "code",
        line: s.location.range?.startLine ?? 1,
        text: s.excerpt,
      })),
    ];
    for (const s of segments) {
      for (const m of s.text.matchAll(SUPPRESSIONS)) {
        const line = s.line + (s.text.slice(0, m.index).match(/\n/g) ?? []).length;
        out.push({
          kind: "suppression",
          confidence: "heuristic",
          severity: "info",
          location: { path: file.path, range: { startLine: line } },
          relatedLocations: [],
          message: `Observed ${m[0]}; inspect scope, rationale and expiry. Supported suppressions and useful comments remain valid; presence alone does not establish misuse.`,
        });
      }
      for (const r of policy?.rules ?? []) {
        const scoped =
          r.scope.some((g) => matches(file.path, g)) ||
          r.documentation?.some((g) => matches(file.path, g));
        if (
          !scoped ||
          !["comment", "example", "documentation"].includes(s.kind) ||
          !["restricted-call", "restricted-import", "module-boundary"].includes(r.kind)
        )
          continue;
        const name = r.match.replaceAll("*", "");
        if (!name || !s.text.includes(name)) continue;
        out.push({
          kind: "misleading-example",
          confidence: "heuristic",
          severity: "info",
          ruleId: r.id,
          location: { path: file.path, range: { startLine: s.line } },
          relatedLocations: [ruleLocation(r)],
          message: `${s.kind} mentions ${name}, which is restricted by scoped rule ${r.id}. It may be a counterexample or rationale; inspect before changing it.${r.replacement ? ` Preferred replacement: ${r.replacement}.` : ""}`,
        });
      }
    }
  }
  return [
    ...new Map(
      out.map((f) => [
        `${f.kind}:${f.ruleId}:${f.location.path}:${f.location.range?.startLine}:${f.message}`,
        f,
      ]),
    ).values(),
  ];
}
