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
          `--pretty=format:%H${FIELD_SEP}%s${FIELD_SEP}%ae${RECORD_SEP}`,
        ],
        { cwd: ctx.cwd, maxBuffer: 8 * 1024 * 1024 },
      );
      const commits = parseLog(stdout);
      return { available: true, commits };
    } catch {
      return { available: false, commits: [] };
    }
  },
};

function parseLog(raw: string): CommitRecord[] {
  const out: CommitRecord[] = [];
  for (const record of raw.split(RECORD_SEP)) {
    const trimmed = record.replace(/^\n+/, "");
    if (trimmed.length === 0) continue;
    const [sha, subject, authorEmail] = trimmed.split(FIELD_SEP);
    if (!sha || !subject) continue;
    out.push({ sha, subject, authorEmail: authorEmail ?? "" });
  }
  return out;
}
