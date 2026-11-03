import { defineProbe } from "@esbenwiberg/repofit/sdk";

const ROOT_FILES = [
  "CONTRIBUTING.md",
  "CONTRIBUTING",
  "CONTRIBUTING.rst",
  "CONTRIBUTING.txt",
  "contributing.md",
];

/**
 * A contributing guide kept under `docs/` or `.github/`: `CONTRIBUTING.md`,
 * `contributing-guide.md`, `contributor-workflow.md`. A bare `contributors`
 * file is a roster, not a guide, and does not count.
 */
const GUIDE_DIRS = /^(?:docs|\.github)\//i;
const GUIDE_NAME = /(?:^|\/)contribut(?:ing(?:[-_.][\w-]*)?|or[-_][\w-]*)\.(?:md|rst|txt|adoc)$/i;

export default defineProbe({
  id: "docs.contributing-present",
  version: "1.0.1",
  dimensions: [{ id: "context", weight: 1 }],
  tier: "static",
  evidence: ["files", "size_stats"],
  rationale: `
    A contributing guide tells an agent (and humans) how this project expects
    change to flow: branch naming, commit format, review process, where
    tests live. Without it, agents fall back to generic defaults that
    rarely match house style. The guide may live at the root as
    CONTRIBUTING.md, or under docs/ or .github/ as a contributing or
    contributor guide.
  `,
  remediation:
    "Add `CONTRIBUTING.md` at the repo root, or a contributing guide under `docs/` or `.github/`. Cover: branch naming, commit message format, how to run tests/lint, the PR/review process, and where tests/specs live.",

  async detect(ev) {
    if (ROOT_FILES.some((p) => ev.files.has(p))) {
      return { kind: "predicate", value: true };
    }
    const guide = ev.size_stats.files.some(
      (f) => GUIDE_DIRS.test(f.path) && GUIDE_NAME.test(f.path),
    );
    return { kind: "predicate", value: guide };
  },

  score: { kind: "predicate", direction: "positive" },

  fixtures: [
    {
      name: "root-contributing",
      evidence: {
        files: ["CONTRIBUTING.md"],
        size_stats: { files: [], totalBytes: 0, totalFiles: 0, source: "git-ls-files" },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "contributor-guide-under-docs",
      evidence: {
        files: ["docs/contributor-workflow.md"],
        size_stats: {
          source: "git-ls-files",
          totalBytes: 400,
          totalFiles: 2,
          files: [
            { path: "AGENTS.md", bytes: 200, lines: 10, depth: 1 },
            { path: "docs/contributor-workflow.md", bytes: 200, lines: 10, depth: 2 },
          ],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "contributing-under-github",
      evidence: {
        files: [".github/CONTRIBUTING.md"],
        size_stats: {
          source: "git-ls-files",
          totalBytes: 200,
          totalFiles: 1,
          files: [{ path: ".github/CONTRIBUTING.md", bytes: 200, lines: 10, depth: 2 }],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "roster-is-not-a-guide",
      evidence: {
        files: ["docs/contributors.md", "src/contributing/index.ts"],
        size_stats: {
          source: "git-ls-files",
          totalBytes: 300,
          totalFiles: 2,
          files: [
            { path: "docs/contributors.md", bytes: 200, lines: 10, depth: 2 },
            { path: "src/contributing/index.ts", bytes: 100, lines: 5, depth: 3 },
          ],
        },
      },
      expect: { reading: { kind: "predicate", value: false }, score: 0 },
    },
    {
      name: "absent",
      evidence: {
        files: [],
        size_stats: { files: [], totalBytes: 0, totalFiles: 0, source: "git-ls-files" },
      },
      expect: { reading: { kind: "predicate", value: false }, score: 0 },
    },
  ],
});
