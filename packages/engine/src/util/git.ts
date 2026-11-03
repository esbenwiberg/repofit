import { exec } from "./exec.js";

const REMOTE_URL_REGEX = /github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?(?:\s|$)/i;

export async function gitHeadCommit(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function detectGithubRemote(
  cwd: string,
): Promise<{ owner: string; repo: string } | null> {
  try {
    const { stdout } = await exec("git", ["remote", "get-url", "origin"], { cwd });
    const match = REMOTE_URL_REGEX.exec(stdout.trim());
    if (!match?.[1] || !match[2]) return null;
    return { owner: match[1], repo: match[2] };
  } catch {
    return null;
  }
}

/**
 * Whether git ignores `path` (relative to `cwd`). Returns `null` when the
 * answer is unknowable — not a git repo, git missing, or check-ignore errored.
 */
export async function gitIgnoresPath(cwd: string, path: string): Promise<boolean | null> {
  try {
    await exec("git", ["check-ignore", "-q", "--", path], { cwd });
    return true;
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code === 1) return false;
    return null;
  }
}

export async function detectDefaultBranch(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await exec("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], {
      cwd,
    });
    return stdout.trim().replace(/^origin\//, "") || null;
  } catch {
    return null;
  }
}

/**
 * `git ls-files`-tracked paths relative to `cwd`. Returns `null` when git
 * isn't available or the directory isn't a git repo — callers fall back to
 * "no evidence" rather than guessing from a filesystem walk.
 */
export async function listTrackedFiles(cwd: string): Promise<string[] | null> {
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

export type TrackedEntry = {
  path: string;
  /** Index mode: `100644`, `100755`, `120000` (symlink) or `160000` (submodule). */
  mode: string;
};

/**
 * `git ls-files -s` entries with their index mode, so a symlink is recognised
 * from the index even on a checkout with `core.symlinks=false` where the
 * working tree holds it as a text file. `null` when git is unavailable or the
 * directory is not a repository.
 */
export async function listTrackedEntries(cwd: string): Promise<TrackedEntry[] | null> {
  try {
    const { stdout } = await exec("git", ["ls-files", "-s", "-z"], {
      cwd,
      maxBuffer: 32 * 1024 * 1024,
    });
    const entries: TrackedEntry[] = [];
    for (const record of stdout.split("\0")) {
      if (record.length === 0) continue;
      const tab = record.indexOf("\t");
      if (tab < 0) continue;
      const mode = record.slice(0, record.indexOf(" "));
      const path = record.slice(tab + 1);
      if (mode.length === 0 || path.length === 0) continue;
      entries.push({ path, mode });
    }
    return entries;
  } catch {
    return null;
  }
}
