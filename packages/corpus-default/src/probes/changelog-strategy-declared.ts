import { defineProbe } from "@esbenwiberg/repofit/sdk";

const STRATEGY_FILES = [
  "CHANGELOG.md",
  "CHANGES.md",
  "RELEASES.md",
  "RELEASE_NOTES.md",
  ".changeset/config.json",
  ".changes/config.json",
];

const RELEASE_NOTES_DIRS = ["docs/release", "docs/releases", "releases", "release-notes"];

const RELEASE_NOTE_FILE = /^(docs\/release|docs\/releases|releases|release-notes)\/[^/]+\.md$/i;

export default defineProbe({
  id: "changelog.strategy-declared",
  version: "1.1.0",
  dimensions: [{ id: "consistency", weight: 1 }],
  tier: "static",
  evidence: ["files", "size_stats"],

  rationale: `
    A declared changelog strategy tells the agent how release notes are
    captured here — a hand-edited CHANGELOG, a fragments directory like
    .changeset, a tool config, or a per-release notes directory
    (docs/release/, releases/). Without a declared strategy, the agent has
    to guess, and may invent a process that conflicts with the team's
    actual release flow.
  `,

  async detect(ev) {
    if (STRATEGY_FILES.some((p) => ev.files.has(p))) {
      return { kind: "predicate", value: true };
    }
    for (const dir of RELEASE_NOTES_DIRS) {
      if (!ev.files.has(dir)) continue;
      const hasNote = ev.size_stats.files.some((f) => RELEASE_NOTE_FILE.test(f.path));
      if (hasNote) return { kind: "predicate", value: true };
    }
    return { kind: "predicate", value: false };
  },

  score: { kind: "predicate", direction: "positive" },

  fixtures: [
    {
      name: "changelog-md",
      evidence: {
        files: ["CHANGELOG.md"],
        size_stats: { files: [], totalBytes: 0, totalFiles: 0, source: "git-ls-files" },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "changesets",
      evidence: {
        files: [".changeset/config.json"],
        size_stats: { files: [], totalBytes: 0, totalFiles: 0, source: "git-ls-files" },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "release-notes-dir",
      evidence: {
        files: ["docs/release", "docs/release/v1.0.0.md"],
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 1,
          files: [{ path: "docs/release/v1.0.0.md", bytes: 100, lines: 10, depth: 2 }],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "no-strategy",
      evidence: {
        files: [],
        size_stats: { files: [], totalBytes: 0, totalFiles: 0, source: "git-ls-files" },
      },
      expect: { reading: { kind: "predicate", value: false }, score: 0 },
    },
  ],
});
