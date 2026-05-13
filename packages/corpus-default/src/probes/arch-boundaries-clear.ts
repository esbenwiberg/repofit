import { defineProbe } from "@esbenwiberg/repofit/sdk";

const PROBE_VERSION = "1.0.0";
const MAX_TREE_ENTRIES = 200;
const MAX_README_CHARS = 5_000;

const RUBRIC = {
  task: "Judge whether this project's module boundaries are clear enough for a coding agent to know where to add new code, given only the directory structure and (optionally) a README excerpt.",
  criteria: [
    {
      id: "names-tell-story",
      description:
        "Do directory, package, and top-level folder names communicate what's inside? Generic names like utils/, common/, helpers/, lib/, misc/ are worth fewer points than names that describe a concept (auth/, scoring/, reporters/).",
    },
    {
      id: "single-responsibility",
      description:
        "From names alone, does each top-level module/package seem to own a coherent slice? Or do names overlap (parser/ + parsing/ + ast/) or look like junk drawers (core/ containing everything)?",
    },
    {
      id: "documented-boundaries",
      description:
        "Does the README or top-level structure tell the agent where major code lives? An explicit 'where to find things' map, an architecture section, or a clear monorepo layout all count. Absence is okay only if names are very strong.",
    },
  ],
} as const;

type TreeEntry = { path: string; depth: number };

function buildTreeView(files: { path: string }[]): string {
  const dirs = new Set<string>();
  for (const f of files) {
    const parts = f.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join("/"));
    }
  }

  const topDirs = new Map<string, number>();
  for (const f of files) {
    const top = f.path.split("/")[0];
    if (!top) continue;
    if (f.path.includes("/")) topDirs.set(top, (topDirs.get(top) ?? 0) + 1);
  }

  const entries: TreeEntry[] = [];
  const sortedDirs = [...dirs].sort();
  for (const d of sortedDirs) {
    const depth = d.split("/").length - 1;
    if (depth <= 2) entries.push({ path: d, depth });
    if (entries.length >= MAX_TREE_ENTRIES) break;
  }

  const lines: string[] = ["Top-level entries (with file counts):"];
  const topNames = [...topDirs.entries()].sort((a, b) => b[1] - a[1]);
  for (const [name, count] of topNames) {
    lines.push(`  ${name}/  (${count} files)`);
  }

  lines.push("", "Directory tree (depth ≤ 2):");
  for (const e of entries) {
    const indent = "  ".repeat(e.depth);
    const leaf = e.path.split("/").slice(-1)[0];
    lines.push(`${indent}${leaf}/`);
  }
  if (sortedDirs.length > entries.length) {
    lines.push(`  … ${sortedDirs.length - entries.length} more directories truncated`);
  }
  return lines.join("\n");
}

export default defineProbe({
  id: "arch.boundaries-clear",
  version: PROBE_VERSION,
  dimensions: [
    { id: "context", weight: 0.7 },
    { id: "consistency", weight: 0.5 },
  ],
  tier: "reasoned",
  evidence: ["files", "size_stats", "judge"],

  rationale: `
    A repo whose top-level layout reads like a table of contents — auth/,
    scoring/, reporters/ — lets the agent skip exploration. A repo full of
    utils/, common/, and core/ forces every change to start with a
    spelunking expedition. This probe shows an LLM the directory tree (plus
    README excerpt if available) and asks whether the boundaries are
    legible from names alone. Cached.
  `,

  async detect(ev) {
    const stats = ev.size_stats;
    if (stats.source === "none" || stats.files.length === 0) {
      return { kind: "na", reason: "no file inventory available" };
    }

    const tree = buildTreeView(stats.files);
    const readme = await ev.files.readText("README.md");
    const readmeSlice = readme === undefined ? "" : readme.slice(0, MAX_README_CHARS);

    const parts: string[] = [tree];
    if (readmeSlice.length > 0) {
      parts.push("", "---", "", "# README.md excerpt", "", readmeSlice);
    }
    const input = parts.join("\n");

    const result = await ev.judge.score({
      probeId: "arch.boundaries-clear",
      probeVersion: PROBE_VERSION,
      input,
      rubric: RUBRIC,
    });

    return {
      kind: "judge",
      score: result.score,
      perCriterion: result.perCriterion,
      rationale: result.rationale,
      model: result.model,
    };
  },

  score: { kind: "judge" },

  fixtures: [
    {
      name: "no-inventory",
      evidence: {
        size_stats: { files: [], totalBytes: 0, totalFiles: 0, source: "none" },
      },
      expect: {
        reading: { kind: "na", reason: "no file inventory available" },
        score: null,
      },
    },
    {
      name: "clear-boundaries",
      evidence: {
        size_stats: {
          source: "git-ls-files",
          totalBytes: 1000,
          totalFiles: 4,
          files: [
            { path: "src/auth/login.ts", bytes: 100, lines: 10, depth: 2 },
            { path: "src/scoring/index.ts", bytes: 100, lines: 10, depth: 2 },
            { path: "src/reporters/html.ts", bytes: 100, lines: 10, depth: 2 },
            { path: "README.md", bytes: 200, lines: 20, depth: 0 },
          ],
        },
        files: { "README.md": "# proj\n\n## Architecture\n\nauth, scoring, reporters." },
        judge: {
          score: 80,
          perCriterion: {
            "names-tell-story": 80,
            "single-responsibility": 80,
            "documented-boundaries": 80,
          },
          rationale: "Boundaries readable from names, README confirms.",
          model: "fixture",
        },
      },
      expect: {
        reading: {
          kind: "judge",
          score: 80,
          perCriterion: {
            "names-tell-story": 80,
            "single-responsibility": 80,
            "documented-boundaries": 80,
          },
          rationale: "Boundaries readable from names, README confirms.",
          model: "fixture",
        },
        score: 80,
      },
    },
    {
      name: "junk-drawer",
      evidence: {
        size_stats: {
          source: "git-ls-files",
          totalBytes: 500,
          totalFiles: 3,
          files: [
            { path: "src/utils/index.ts", bytes: 100, lines: 10, depth: 2 },
            { path: "src/common/helpers.ts", bytes: 100, lines: 10, depth: 2 },
            { path: "src/core/everything.ts", bytes: 300, lines: 30, depth: 2 },
          ],
        },
        judge: {
          score: 20,
          perCriterion: {
            "names-tell-story": 20,
            "single-responsibility": 0,
            "documented-boundaries": 20,
          },
          rationale: "Generic names; no README architecture pointer.",
          model: "fixture",
        },
      },
      expect: {
        reading: {
          kind: "judge",
          score: 20,
          perCriterion: {
            "names-tell-story": 20,
            "single-responsibility": 0,
            "documented-boundaries": 20,
          },
          rationale: "Generic names; no README architecture pointer.",
          model: "fixture",
        },
        score: 20,
      },
    },
  ],
});
