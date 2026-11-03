import { readFile } from "node:fs/promises";
import path from "node:path";
import { defineFixer } from "@esbenwiberg/repofit/sdk";
import { LOCAL_SETTINGS_GITIGNORE_LINES } from "../probes/agent-local-settings-not-committed.js";

/**
 * Appends the harness local-settings paths to .gitignore. It does not
 * `git rm --cached` the tracked copies: removing tracked content is the
 * user's call, and the remediation text says how.
 */
export default defineFixer({
  probeId: "agent.local-settings-not-committed",
  mode: "static",
  describe: "ignore agent harness local settings files",
  async plan({ cwd }) {
    let existing = "";
    try {
      existing = await readFile(path.join(cwd, ".gitignore"), "utf8");
    } catch {
      existing = "";
    }
    const present = new Set(existing.split("\n").map((l) => l.trim()));
    const entries = LOCAL_SETTINGS_GITIGNORE_LINES.filter(
      (line) => line.startsWith("#") || !present.has(line),
    );
    if (entries.every((line) => line.startsWith("#"))) return null;
    return {
      actions: [
        { kind: "append-lines", path: ".gitignore", lines: entries, createIfMissing: true },
      ],
    };
  },
});
