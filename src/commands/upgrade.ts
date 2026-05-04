import { resolve } from "node:path";
import {
  activeEntries,
  type CatalogEntry,
  type Provide,
} from "../catalog.js";
import { loadMergedCatalog } from "../merged-catalog.js";
import { ensureDirAndCopy } from "../io.js";
import {
  classifyProvideDrift,
  type ProvideDriftKind,
} from "../drift.js";
import {
  findLockedEntry,
  mergeLockedProvides,
  readLockfile,
  sha256OfFile,
  upsertLockedEntry,
  writeLockfile,
  type Lockfile,
  type LockedEntry,
  type LockedProvide,
} from "../lockfile.js";
import { confirm, isInteractive } from "../prompt.js";

export interface UpgradeOptions {
  cwd: string;
  id: string | undefined;
  dryRun: boolean;
  force: boolean;
  nonInteractive: boolean;
}

interface ProvideAction {
  provide: Provide;
  kind: ProvideDriftKind;
}

interface EntryPlan {
  entry: CatalogEntry;
  locked: LockedEntry;
  actions: ProvideAction[];
}

function actionLabel(kind: ProvideDriftKind, force: boolean): string {
  if (kind === "out-of-date") return "refresh-out-of-date";
  if (kind === "missing") return "write-missing";
  return force ? "force-user-edit" : "keep-user-edit";
}

function actionGlyph(kind: ProvideDriftKind, force: boolean): string {
  if (kind === "out-of-date") return "~";
  if (kind === "missing") return "+";
  return force ? "!" : "·";
}

function willWrite(kind: ProvideDriftKind, force: boolean): boolean {
  return kind !== "user-edit" || force;
}

function planReasons(plan: EntryPlan): string[] {
  const reasons: string[] = [];
  if (plan.locked.version !== plan.entry.version) {
    reasons.push(`v${plan.locked.version}→${plan.entry.version}`);
  }
  const counts = {
    "out-of-date": 0,
    "user-edit": 0,
    missing: 0,
  } satisfies Record<ProvideDriftKind, number>;
  for (const a of plan.actions) counts[a.kind] += 1;
  if (counts["out-of-date"] > 0) reasons.push(`${counts["out-of-date"]} out-of-date`);
  if (counts["user-edit"] > 0) {
    reasons.push(`${counts["user-edit"]} user-edit${counts["user-edit"] === 1 ? "" : "s"}`);
  }
  if (counts.missing > 0) reasons.push(`${counts.missing} missing`);
  return reasons;
}

export async function runUpgrade(opts: UpgradeOptions): Promise<number> {
  const lf = await readLockfile(opts.cwd);
  if (lf === null) {
    console.error(
      "agentry upgrade: no agentry.lock.toml — nothing to upgrade.",
    );
    console.error("Hint: run 'agentry add <id>' first to install entries.");
    return 1;
  }

  const { entries } = loadMergedCatalog(opts.cwd);
  const allPlans = await Promise.all(
    activeEntries(entries).map((e) => buildPlan(e, lf, opts.cwd)),
  );
  let plans = allPlans.filter((p): p is EntryPlan => p !== null);

  if (opts.id) {
    plans = plans.filter((p) => p.entry.id === opts.id);
    if (plans.length === 0) {
      console.error(
        `agentry upgrade: '${opts.id}' is not stale, not installed, or unknown.`,
      );
      return 1;
    }
  }

  if (plans.length === 0) {
    console.log("agentry upgrade: nothing to upgrade — all entries current.");
    return 0;
  }

  console.log(`agentry upgrade${opts.dryRun ? " (dry-run)" : ""}`);
  for (const p of plans) {
    console.log(`\n  ${p.entry.id} — ${planReasons(p).join(", ")}`);
    for (const a of p.actions) {
      console.log(
        `    ${actionGlyph(a.kind, opts.force)} ${a.provide.target.padEnd(50)} ${actionLabel(a.kind, opts.force)}`,
      );
    }
  }

  if (opts.dryRun) return 0;

  const interactive = !opts.nonInteractive && isInteractive();
  if (interactive && !(await confirm("\nProceed?", true))) {
    console.log("aborted.");
    return 0;
  }

  let updatedLf: Lockfile = lf;
  for (const plan of plans) {
    updatedLf = await applyPlan(plan, opts.cwd, opts.force, updatedLf);
  }
  await writeLockfile(opts.cwd, updatedLf);
  console.log("\nupgrade complete.");
  return 0;
}

async function buildPlan(
  entry: CatalogEntry,
  lf: Lockfile,
  cwd: string,
): Promise<EntryPlan | null> {
  const locked = findLockedEntry(lf, entry.id);
  if (!locked) return null;

  const classified = await Promise.all(
    entry.provides.map(async (provide): Promise<ProvideAction | null> => {
      const dest = resolve(cwd, provide.target);
      const src = resolve(entry.sourceRoot, provide.source);
      const kind = await classifyProvideDrift(src, dest, provide.target, locked);
      return kind === null ? null : { provide, kind };
    }),
  );
  const actions = classified.filter((a): a is ProvideAction => a !== null);

  const versionDrift = locked.version !== entry.version;
  if (actions.length === 0 && !versionDrift) return null;

  return { entry, locked, actions };
}

async function applyPlan(
  plan: EntryPlan,
  cwd: string,
  force: boolean,
  lf: Lockfile,
): Promise<Lockfile> {
  const fresh: LockedProvide[] = [];
  for (const a of plan.actions) {
    if (!willWrite(a.kind, force)) continue;
    const src = resolve(plan.entry.sourceRoot, a.provide.source);
    const dest = resolve(cwd, a.provide.target);
    await ensureDirAndCopy(src, dest);
    fresh.push({
      target: a.provide.target,
      source: a.provide.source,
      flavor: a.provide.flavor,
      checksum: await sha256OfFile(src),
    });
  }

  const merged = mergeLockedProvides(plan.locked.provides, fresh);
  return upsertLockedEntry(lf, {
    id: plan.entry.id,
    version: plan.entry.version,
    installed_at: new Date().toISOString(),
    provides: merged,
    ...(plan.entry.overlay ? { overlay: plan.entry.overlay } : {}),
  });
}
