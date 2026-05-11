import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import type { GatherContext, SizeStatsEvidence, SizeStatsFile } from "../../sdk/types.js";
import { countLines } from "../../util/count-lines.js";

const exec = promisify(execFile);

const SIZE_PROBE_LIMIT = 5000;
const BYTE_THRESHOLD_FOR_LINE_COUNT = 2 * 1024 * 1024;

export const sizeStatsSubsystem = {
  async gather(ctx: GatherContext): Promise<SizeStatsEvidence> {
    const paths = await listTrackedFiles(ctx.cwd);
    if (paths === null) return empty("none");

    const sliced = paths.slice(0, SIZE_PROBE_LIMIT);
    const entries = await Promise.all(sliced.map((p) => describeFile(ctx.cwd, p)));
    const files = entries.filter((e): e is SizeStatsFile => e !== null);

    let totalBytes = 0;
    for (const f of files) totalBytes += f.bytes;

    return {
      files,
      totalBytes,
      totalFiles: files.length,
      source: "git-ls-files",
    };
  },
};

async function listTrackedFiles(cwd: string): Promise<string[] | null> {
  try {
    const { stdout } = await exec("git", ["ls-files", "-z"], { cwd, maxBuffer: 32 * 1024 * 1024 });
    return stdout
      .split("\0")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  } catch {
    return null;
  }
}

async function describeFile(cwd: string, path: string): Promise<SizeStatsFile | null> {
  const abs = join(cwd, path);
  let bytes: number;
  try {
    const s = await stat(abs);
    if (!s.isFile()) return null;
    bytes = s.size;
  } catch {
    return null;
  }

  let lines = 0;
  if (bytes > 0 && bytes < BYTE_THRESHOLD_FOR_LINE_COUNT) {
    try {
      const text = await readFile(abs, "utf8");
      lines = countLines(text);
    } catch {
      lines = 0;
    }
  }

  const rel = relative(cwd, abs);
  return {
    path: rel || path,
    bytes,
    lines,
    depth: rel.split("/").length,
  };
}

function empty(source: SizeStatsEvidence["source"]): SizeStatsEvidence {
  return { files: [], totalBytes: 0, totalFiles: 0, source };
}
