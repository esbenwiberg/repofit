import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gatherAll } from "../evidence/registry.js";
import { type LoadedCorpus, loadDefaultCorpus } from "../loader/corpus.js";
import { DEFAULT_TIERS, runProbes } from "../runner/tiered.js";
import type { FixAction, Fixer, FixPlan, Probe, Reading } from "../sdk/types.js";

export type ApplyOptions = {
  cwd: string;
  probeId?: string;
  write?: boolean;
};

type PlannedFix = {
  probe: Probe;
  fixer: Fixer;
  plan: FixPlan;
};

export async function apply(opts: ApplyOptions): Promise<{ stdout: string; exitCode: number }> {
  const corpus = await loadDefaultCorpus();
  const fixersByProbe = indexFixers(corpus);

  const probes = filterProbes(corpus, opts.probeId, fixersByProbe);
  if (opts.probeId && probes.length === 0) {
    return {
      stdout: `repofit: no fixer registered for probe '${opts.probeId}'.\n`,
      exitCode: 2,
    };
  }
  if (probes.length === 0) {
    return { stdout: "no fixers registered in the corpus.\n", exitCode: 0 };
  }

  const evidence = await gatherAll({ cwd: opts.cwd, judge: {} });
  const results = await runProbes(probes, evidence, { includeTiers: DEFAULT_TIERS });

  const planned: PlannedFix[] = [];
  for (const r of results) {
    if (r.score === null || r.score >= 100) continue;
    if (r.reading.kind === "na" || r.reading.kind === "error") continue;
    const fixer = fixersByProbe.get(r.probe.id);
    if (!fixer) continue;
    const plan = await fixer.plan({ cwd: opts.cwd, probe: r.probe, reading: r.reading });
    if (!plan || plan.actions.length === 0) continue;
    planned.push({ probe: r.probe, fixer, plan });
  }

  if (planned.length === 0) {
    return { stdout: "no fixable findings.\n", exitCode: 0 };
  }

  if (!opts.write) return { stdout: renderDryRun(planned), exitCode: 0 };

  const summary: string[] = [];
  let applied = 0;
  let skipped = 0;
  for (const p of planned) {
    const r = await executePlan(opts.cwd, p);
    summary.push(...r.lines);
    applied += r.applied;
    skipped += r.skipped;
  }

  const head = `applied ${applied} action${applied === 1 ? "" : "s"}${
    skipped > 0 ? ` (${skipped} skipped — file already exists or line present)` : ""
  }:\n`;
  return {
    stdout: `${head}${summary.join("\n")}\n\nRun \`repofit check\` to see your new score.\n`,
    exitCode: 0,
  };
}

function indexFixers(corpus: LoadedCorpus): Map<string, Fixer> {
  const out = new Map<string, Fixer>();
  for (const f of corpus.fixers) out.set(f.probeId, f);
  return out;
}

function filterProbes(
  corpus: LoadedCorpus,
  probeId: string | undefined,
  fixersByProbe: Map<string, Fixer>,
): Probe[] {
  if (probeId) return corpus.probes.filter((p) => p.id === probeId && fixersByProbe.has(p.id));
  return corpus.probes.filter((p) => fixersByProbe.has(p.id));
}

function renderDryRun(planned: PlannedFix[]): string {
  const lines: string[] = [];
  const total = planned.reduce((n, p) => n + p.plan.actions.length, 0);
  lines.push(
    `${planned.length} fixable finding${planned.length === 1 ? "" : "s"} (${total} action${
      total === 1 ? "" : "s"
    }; dry run — pass --write to apply):`,
  );
  lines.push("");
  for (const p of planned) {
    lines.push(`  ${p.probe.id}  →  ${p.fixer.describe}`);
    for (const action of p.plan.actions) {
      lines.push(`    ${describeAction(action)}`);
    }
    for (const note of p.plan.notes ?? []) {
      lines.push(`    # ${note}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function describeAction(action: FixAction): string {
  if (action.kind === "write-file") {
    const flag = action.ifMissing ? " (only if missing)" : "";
    return `+ write   ${action.path}${flag}`;
  }
  return `~ append  ${action.path}  (${action.lines.length} line${
    action.lines.length === 1 ? "" : "s"
  })`;
}

async function executePlan(
  cwd: string,
  p: PlannedFix,
): Promise<{ lines: string[]; applied: number; skipped: number }> {
  const lines: string[] = [];
  let applied = 0;
  let skipped = 0;
  for (const action of p.plan.actions) {
    const result = await executeAction(cwd, action);
    lines.push(`  ${p.probe.id}  →  ${result}`);
    if (result.startsWith("skipped")) skipped += 1;
    else applied += 1;
  }
  return { lines, applied, skipped };
}

async function executeAction(cwd: string, action: FixAction): Promise<string> {
  const abs = path.join(cwd, action.path);
  if (action.kind === "write-file") {
    if (action.ifMissing && (await exists(abs))) {
      return `skipped ${action.path} (already exists)`;
    }
    await writeFile(abs, action.content, "utf8");
    return `wrote ${action.path}`;
  }
  const existing = (await readSafe(abs)) ?? (action.createIfMissing ? "" : null);
  if (existing === null) return `skipped ${action.path} (file does not exist)`;
  const existingLines = new Set(existing.split("\n"));
  const newLines = action.lines.filter((l) => !existingLines.has(l));
  if (newLines.length === 0) return `skipped ${action.path} (all lines already present)`;
  const trailing = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  await writeFile(abs, `${existing}${trailing}${newLines.join("\n")}\n`, "utf8");
  return `appended ${newLines.length} line${newLines.length === 1 ? "" : "s"} to ${action.path}`;
}

async function exists(p: string): Promise<boolean> {
  try {
    await readFile(p);
    return true;
  } catch {
    return false;
  }
}

async function readSafe(p: string): Promise<string | null> {
  try {
    return await readFile(p, "utf8");
  } catch {
    return null;
  }
}

export type { Reading };
