import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import {
  findLockedEntry,
  readLockfile,
  removeLockedEntry,
  sha256OfFile,
  upsertLockedEntry,
  writeLockfile,
  type LockedEntry,
  type LockedProvide,
  type Lockfile,
} from "../lockfile.js";
import { confirm, isInteractive } from "../prompt.js";

export interface RemoveOptions {
  cwd: string;
  id: string;
  dryRun: boolean;
  force: boolean;
  nonInteractive: boolean;
}

type RemovalKind = "clean" | "user-edit" | "already-gone";

interface ProvideOutcome {
  provide: LockedProvide;
  kind: RemovalKind;
}

function removalLabel(kind: RemovalKind, force: boolean): string {
  if (kind === "clean") return "delete-clean";
  if (kind === "already-gone") return "already-gone";
  return force ? "delete-user-edit" : "keep-user-edit";
}

function removalGlyph(kind: RemovalKind, force: boolean): string {
  if (kind === "clean") return "-";
  if (kind === "user-edit") return force ? "!" : "·";
  return "";
}

function shouldDelete(kind: RemovalKind, force: boolean): boolean {
  return kind === "clean" || (kind === "user-edit" && force);
}

export async function runRemove(opts: RemoveOptions): Promise<number> {
  const lf = await readLockfile(opts.cwd);
  if (lf === null) {
    console.error(
      "agentry remove: no agentry.lock.toml — nothing to remove.",
    );
    return 1;
  }

  const locked = findLockedEntry(lf, opts.id);
  if (!locked) {
    console.error(`agentry remove: '${opts.id}' is not installed.`);
    return 1;
  }

  const outcomes = await Promise.all(
    locked.provides.map((p) => classify(p, opts.cwd)),
  );

  console.log(`agentry remove ${opts.id}${opts.dryRun ? " (dry-run)" : ""}`);
  for (const o of outcomes) {
    if (o.kind === "already-gone") continue;
    console.log(
      `  ${removalGlyph(o.kind, opts.force)} ${o.provide.target.padEnd(50)} ${removalLabel(o.kind, opts.force)}`,
    );
  }

  const skipped = outcomes.filter(
    (o) => o.kind === "user-edit" && !opts.force,
  ).length;
  const gone = outcomes.filter((o) => o.kind === "already-gone").length;
  if (skipped > 0) {
    console.log(
      `\n  ${skipped} user-edited file${skipped === 1 ? "" : "s"} kept. Use --force to delete.`,
    );
  }
  if (gone > 0) {
    console.log(`  ${gone} already gone.`);
  }

  if (opts.dryRun) return 0;

  // Default to NO — removal is destructive (upgrade defaults to YES).
  const interactive = !opts.nonInteractive && isInteractive();
  if (interactive && !(await confirm("\nProceed?", false))) {
    console.log("aborted.");
    return 0;
  }

  const updatedLf = await applyRemoval(locked, outcomes, opts.cwd, opts.force, lf);
  await writeLockfile(opts.cwd, updatedLf);
  console.log("\nremove complete.");
  return 0;
}

async function classify(
  provide: LockedProvide,
  cwd: string,
): Promise<ProvideOutcome> {
  const dest = resolve(cwd, provide.target);
  if (!existsSync(dest)) return { provide, kind: "already-gone" };
  const destHash = await sha256OfFile(dest);
  return {
    provide,
    kind: destHash === provide.checksum ? "clean" : "user-edit",
  };
}

async function applyRemoval(
  locked: LockedEntry,
  outcomes: ProvideOutcome[],
  cwd: string,
  force: boolean,
  lf: Lockfile,
): Promise<Lockfile> {
  const toDelete = outcomes.filter((o) => shouldDelete(o.kind, force));
  const kept = outcomes
    .filter((o) => o.kind === "user-edit" && !force)
    .map((o) => o.provide);

  await Promise.all(
    toDelete.map((o) => unlink(resolve(cwd, o.provide.target))),
  );

  if (kept.length === 0) {
    return removeLockedEntry(lf, locked.id);
  }
  // Preserve original install_at — partial remove doesn't reinstall.
  return upsertLockedEntry(lf, {
    id: locked.id,
    version: locked.version,
    installed_at: locked.installed_at,
    provides: kept,
    ...(locked.overlay ? { overlay: locked.overlay } : {}),
  });
}
