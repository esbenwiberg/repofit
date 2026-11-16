import { safeRead } from "./indexer.js";
import type { AnalysisReport } from "./types.js";

const CAPABILITIES = ["start", "reset", "seed", "inspect", "fault"];
const relativePath = (p: string) =>
  !!p &&
  !p.startsWith("/") &&
  !p.includes("\\") &&
  !/^[a-z]:/i.test(p) &&
  !p.split("/").includes("..") &&
  !p.includes("\0");
const httpUrl = (value: unknown) => {
  try {
    return (
      typeof value === "string" &&
      !/[{}]/.test(value.replaceAll("{port}", "1")) &&
      ["http:", "https:"].includes(new URL(value.replaceAll("{port}", "1")).protocol)
    );
  } catch {
    return false;
  }
};
export async function assessReadiness(cwd: string): Promise<AnalysisReport["readiness"]> {
  const path = ".agent/verification.json";
  const result: AnalysisReport["readiness"] = {
    path,
    declared: null,
    observed: [],
    inferred: [],
    unknowns: [],
  };
  try {
    const raw = JSON.parse(await safeRead(cwd, path)) as Record<string, unknown>;
    if (
      raw?.schema !== 1 ||
      !Array.isArray(raw.features) ||
      raw.features.length > 1000 ||
      !raw.capabilities ||
      typeof raw.capabilities !== "object" ||
      Array.isArray(raw.capabilities) ||
      !raw.source ||
      typeof raw.source !== "object"
    )
      throw new Error("expected schema:1, source, <=1000 features and capabilities");
    const source = raw.source as Record<string, unknown>;
    if (
      typeof source.tool !== "string" ||
      !source.tool.trim() ||
      typeof source.config !== "string" ||
      !relativePath(source.config)
    )
      throw new Error("source requires tool and repository-relative config");
    const ids = new Set<string>();
    for (const f of raw.features as Record<string, unknown>[]) {
      if (
        !f ||
        typeof f.id !== "string" ||
        !f.id ||
        ids.has(f.id) ||
        typeof f.name !== "string" ||
        !f.name.trim() ||
        !f.expectationSource ||
        typeof f.expectationSource !== "object"
      )
        throw new Error("features require unique id, name and expectationSource");
      const origin = f.expectationSource as Record<string, unknown>;
      if (
        !["requirement", "accepted", "hypothesis"].includes(String(origin.kind)) ||
        typeof origin.reference !== "string" ||
        !origin.reference.trim()
      )
        throw new Error("feature expectationSource requires kind and reference");
      for (const key of ["aliases", "paths", "invariants"])
        if (
          f[key] !== undefined &&
          (!Array.isArray(f[key]) || !(f[key] as unknown[]).every((v) => typeof v === "string"))
        )
          throw new Error(`feature ${key} requires strings`);
      if ((f.paths as string[] | undefined)?.some((p) => !relativePath(p)))
        throw new Error("feature paths must be repository relative");
      ids.add(f.id);
    }
    for (const [name, value] of Object.entries(raw.capabilities)) {
      if (!CAPABILITIES.includes(name)) {
        result.unknowns.push(`Unrecognized capability ${name}; preserved as declaration.`);
        continue;
      }
      const c = value as Record<string, unknown>;
      if (!c || typeof c !== "object" || c.status !== "declared")
        throw new Error(`capability ${name} requires status:declared`);
      const hasCommand = c.command !== undefined;
      if (
        hasCommand &&
        (!Array.isArray(c.command) ||
          !c.command.length ||
          !c.command.every((x) => typeof x === "string" && x.trim() && !x.includes("\0")))
      )
        throw new Error(`capability ${name} requires nonempty argv`);
      if (c.url !== undefined && !httpUrl(c.url))
        throw new Error(`capability ${name} requires HTTP(S) URL`);
      if (
        c.method !== undefined &&
        (!httpUrl(c.url) ||
          !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(String(c.method)))
      )
        throw new Error(`capability ${name} has invalid HTTP method`);
      if (!hasCommand && !httpUrl(c.url))
        throw new Error(`capability ${name} requires command or URL`);
    }
    result.declared = raw;
    result.unknowns.push(
      "Capabilities are declarations, not observed successful execution; feature hypotheses are not accepted requirements.",
    );
    for (const capability of CAPABILITIES)
      if (!(capability in raw.capabilities))
        result.unknowns.push(`${capability} capability is undeclared; implementation is unknown.`);
  } catch (err) {
    result.unknowns.push(
      `Verification descriptor unavailable or invalid: ${String(err)}. Runnable/reset/seed/inspect abilities remain unknown.`,
    );
  }
  return result;
}
