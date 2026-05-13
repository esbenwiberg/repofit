import { defineProbe } from "@esbenwiberg/repofit/sdk";

const SPEC_DIRS = [
  "specs",
  "spec",
  ".specify",
  "docs/specs",
  "docs/features",
  "features",
  ".features",
  "rfcs",
  "docs/rfcs",
];

const SPEC_FILE = /\.(?:md|markdown)$/i;

export default defineProbe({
  id: "specs.present",
  version: "1.0.0",
  dimensions: [{ id: "context", weight: 1 }],
  tier: "derived",
  evidence: ["files", "size_stats"],

  rationale: `
    Spec-driven development — a short doc per feature with description,
    design, acceptance criteria, and test cases — is the most reliable way
    to keep agents and humans aligned on what to build. A repo with a
    specs/ or .specify/ directory of feature specs gives the agent the
    same starting point a human gets. This probe checks for that directory
    and at least one spec file inside it.
  `,

  remediation:
    "Create a `specs/` (or `.specify/`) directory and put one markdown file per feature in it. Each spec should cover: problem, design sketch, acceptance criteria, and edge cases. Even a single short spec is a meaningful signal.",

  async detect(ev) {
    for (const dir of SPEC_DIRS) {
      if (!ev.files.has(dir)) continue;
      const hasSpec = ev.size_stats.files.some(
        (f) => f.path.startsWith(`${dir}/`) && SPEC_FILE.test(f.path),
      );
      if (hasSpec) return { kind: "predicate", value: true };
    }
    return { kind: "predicate", value: false };
  },

  score: { kind: "predicate", direction: "positive" },

  fixtures: [
    {
      name: "specs-dir-with-md",
      evidence: {
        files: ["specs", "specs/auth.md"],
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 1,
          files: [{ path: "specs/auth.md", bytes: 100, lines: 10, depth: 1 }],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "specify-dir",
      evidence: {
        files: [".specify", ".specify/login.md"],
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 1,
          files: [{ path: ".specify/login.md", bytes: 100, lines: 10, depth: 1 }],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "no-specs",
      evidence: {
        files: [],
        size_stats: { files: [], totalBytes: 0, totalFiles: 0, source: "git-ls-files" },
      },
      expect: { reading: { kind: "predicate", value: false }, score: 0 },
    },
  ],
});
