import type { CommitHistoryEvidence, CommitRecord, GatherContext } from "../../sdk/types.js";
import { exec } from "../../util/exec.js";

const DEFAULT_COMMIT_LIMIT = 100;
const RECORD_SEP = "\x1e";
const FIELD_SEP = "\x1f";

export const commitHistorySubsystem = {
  async gather(ctx: GatherContext): Promise<CommitHistoryEvidence> {
    try {
      const { stdout } = await exec(
        "git",
        [
          "log",
          // Merge subjects are generated (the GitHub button, a PR's synthetic
          // merge ref), not authored; probes read what people wrote.
          "--no-merges",
          `-n`,
          String(DEFAULT_COMMIT_LIMIT),
          // One pass lists every path each commit touched, so a probe can
          // measure per-file churn without a `git log --follow` per file.
          "--name-only",
          `--pretty=format:%H${FIELD_SEP}%s${FIELD_SEP}%ae${RECORD_SEP}`,
        ],
        { cwd: ctx.cwd, maxBuffer: 32 * 1024 * 1024 },
      );
      const commits = parseLog(stdout);
      return { available: true, commits };
    } catch {
      return { available: false, commits: [] };
    }
  },
};

/**
 * Parses `git log --name-only` output in the format above. Each record is
 * `sha␟subject␟email␞` followed by the touched paths, one per line, until
 * the next record. Exported for tests.
 */
export function parseLog(raw: string): CommitRecord[] {
  const out: CommitRecord[] = [];
  const records = raw.split(RECORD_SEP);
  // records[0] is the first header; records[i] (i > 0) is the previous
  // commit's path list followed by the next header.
  let pending: CommitRecord | null = null;
  for (const record of records) {
    const lines = record.split("\n");
    const header = lines.pop() ?? "";
    if (pending) {
      pending.files = lines.map((l) => l.trim()).filter((l) => l.length > 0);
      out.push(pending);
      pending = null;
    }
    const [sha, subject, authorEmail] = header.trim().split(FIELD_SEP);
    if (!sha || subject === undefined) continue;
    pending = { sha, subject, authorEmail: authorEmail ?? "", files: [] };
  }
  if (pending) out.push(pending);
  return out;
}
