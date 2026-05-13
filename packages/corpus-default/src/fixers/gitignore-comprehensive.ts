import { readFile } from "node:fs/promises";
import path from "node:path";
import { defineFixer } from "@esbenwiberg/repofit/sdk";

const STANDARD_ENTRIES = [
  "# dependencies",
  "node_modules/",
  "",
  "# build artifacts",
  "dist/",
  "build/",
  "out/",
  "",
  "# env",
  ".env",
  ".env.local",
  ".env.*.local",
  "",
  "# OS junk",
  ".DS_Store",
  "Thumbs.db",
  "",
  "# editor state",
  ".idea/",
  ".vscode/",
];

export default defineFixer({
  probeId: "gitignore.comprehensive",
  mode: "static",
  describe: "add standard entries to .gitignore",
  async plan({ cwd }) {
    const filePath = path.join(cwd, ".gitignore");
    let existing = "";
    try {
      existing = await readFile(filePath, "utf8");
    } catch {
      existing = "";
    }
    const existingLines = new Set(existing.split("\n").map((l) => l.trim()));
    const missing = STANDARD_ENTRIES.filter(
      (line) => line === "" || line.startsWith("#") || !existingLines.has(line.trim()),
    );

    if (existing.length === 0) {
      return {
        actions: [
          {
            kind: "append-lines",
            path: ".gitignore",
            lines: STANDARD_ENTRIES,
            createIfMissing: true,
          },
        ],
      };
    }
    const nonComment = missing.filter((l) => l !== "" && !l.startsWith("#"));
    if (nonComment.length === 0) return null;
    return {
      actions: [{ kind: "append-lines", path: ".gitignore", lines: nonComment }],
    };
  },
});
