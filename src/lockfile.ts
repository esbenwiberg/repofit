import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { ensureDirAndWrite } from "./io.js";
import { AGENTRY_VERSION } from "./version.js";
import { pickOptionalString, pickString } from "./typeguards.js";
import type { Flavor } from "./catalog.js";

const LOCKFILE_NAME = "agentry.lock.toml";
const LOCKFILE_HEADER = `# agentry.lock.toml — managed by 'agentry'. Don't edit by hand.
# Records what was installed by which entry at what catalog version,
# with file checksums so 'agentry doctor' can tell user edits apart
# from source-of-truth updates.

`;

export interface LockedProvide {
  target: string;
  source: string;
  flavor: Flavor;
  checksum: string;
}

export interface LockedEntry {
  id: string;
  version: string;
  installed_at: string;
  provides: LockedProvide[];
  overlay?: string;
}

export interface Lockfile {
  installed: LockedEntry[];
}

export function lockfilePath(cwd: string): string {
  return resolve(cwd, LOCKFILE_NAME);
}

export function emptyLockfile(): Lockfile {
  return { installed: [] };
}

export async function readLockfile(cwd: string): Promise<Lockfile | null> {
  const path = lockfilePath(cwd);
  if (!existsSync(path)) return null;
  const text = await readFile(path, "utf8");
  let raw: unknown;
  try {
    raw = parseToml(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const installedRaw = Array.isArray(r.installed) ? r.installed : [];
  const installed = installedRaw
    .filter(
      (e): e is Record<string, unknown> =>
        typeof e === "object" && e !== null && typeof (e as { id?: unknown }).id === "string",
    )
    .map<LockedEntry>((e) => {
      const overlay = pickOptionalString(e, "overlay");
      return {
        id: pickString(e, "id"),
        version: pickString(e, "version"),
        installed_at: pickString(e, "installed_at"),
        provides: Array.isArray(e.provides)
          ? (e.provides as Record<string, unknown>[])
              .filter((p) => typeof p === "object" && p !== null)
              .map<LockedProvide>((p) => ({
                target: pickString(p, "target"),
                source: pickString(p, "source"),
                flavor: p.flavor === "claude" ? "claude" : "agnostic",
                checksum: pickString(p, "checksum"),
              }))
              .filter((p) => p.target !== "")
          : [],
        ...(overlay ? { overlay } : {}),
      };
    });
  return { installed };
}

export async function writeLockfile(cwd: string, lf: Lockfile): Promise<void> {
  const out = {
    agentry_version: AGENTRY_VERSION,
    generated_at: new Date().toISOString(),
    installed: [...lf.installed].sort((a, b) => a.id.localeCompare(b.id)),
  };
  const body = stringifyToml(out as unknown as Record<string, unknown>);
  await ensureDirAndWrite(lockfilePath(cwd), LOCKFILE_HEADER + body + "\n");
}

export async function sha256OfFile(path: string): Promise<string> {
  const buf = await readFile(path);
  const h = createHash("sha256").update(buf).digest("hex");
  return `sha256:${h}`;
}

export function findLockedEntry(
  lf: Lockfile | null,
  id: string,
): LockedEntry | undefined {
  return lf?.installed.find((e) => e.id === id);
}

export function findLockedProvide(
  entry: LockedEntry | undefined,
  target: string,
): LockedProvide | undefined {
  return entry?.provides.find((p) => p.target === target);
}

export function upsertLockedEntry(lf: Lockfile, entry: LockedEntry): Lockfile {
  const installed = lf.installed.filter((e) => e.id !== entry.id);
  installed.push(entry);
  return { installed };
}

export function removeLockedEntry(lf: Lockfile, id: string): Lockfile {
  return { installed: lf.installed.filter((e) => e.id !== id) };
}

export function mergeLockedProvides(
  prior: LockedProvide[] | undefined,
  fresh: LockedProvide[],
): LockedProvide[] {
  const map = new Map<string, LockedProvide>();
  for (const p of prior ?? []) map.set(p.target, p);
  for (const p of fresh) map.set(p.target, p);
  return [...map.values()].sort((a, b) => a.target.localeCompare(b.target));
}
