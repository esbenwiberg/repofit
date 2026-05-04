import { existsSync } from "node:fs";
import { filesIdentical } from "./io.js";
import {
  findLockedProvide,
  sha256OfFile,
  type LockedEntry,
} from "./lockfile.js";

export type DriftKind = "missing" | "out-of-date" | "user-edit";

export async function classifyProvideDrift(
  src: string,
  dest: string,
  target: string,
  lockedEntry: LockedEntry | undefined,
): Promise<DriftKind | null> {
  if (!existsSync(src)) return null;
  if (!existsSync(dest)) return "missing";
  if (await filesIdentical(src, dest)) return null;
  const locked = findLockedProvide(lockedEntry, target);
  if (locked && (await sha256OfFile(dest)) === locked.checksum) {
    return "out-of-date";
  }
  return "user-edit";
}
