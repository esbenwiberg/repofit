import { defineProbe } from "@esbenwiberg/repofit/sdk";

export const LOCAL_SETTINGS_PATTERNS: readonly RegExp[] = [
  /(^|\/)\.claude\/settings\.local\.json$/,
  /(^|\/)\.codex\/config\.local\.[^/]+$/,
  /(^|\/)\.cursor\/settings\.local\.json$/,
  /(^|\/)\.gemini\/settings\.local\.json$/,
];

export const LOCAL_SETTINGS_GITIGNORE_LINES = [
  "# agent harness local settings (machine allowlists, local env)",
  ".claude/settings.local.json",
  ".codex/config.local.*",
  ".cursor/settings.local.json",
  ".gemini/settings.local.json",
];

export default defineProbe({
  id: "agent.local-settings-not-committed",
  version: "1.0.0",
  dimensions: [{ id: "safety", weight: 0.3 }],
  tier: "static",
  evidence: ["size_stats"],

  rationale: `
    Harness local settings files hold one machine's permission allowlists
    and sometimes environment values. Committed, they leak what one
    developer allowed to everyone and make the next machine inherit it
    silently. The field study found them tracked in repositories whose
    .gitignore covered everything else.
  `,

  remediation:
    "Add the local settings paths to `.gitignore` and remove the tracked copies with `git rm --cached <path>`. Keep shared harness settings in `settings.json`; leave `settings.local.json` to each machine.",

  async detect(ev) {
    const tracked = ev.size_stats.files.filter((f) =>
      LOCAL_SETTINGS_PATTERNS.some((re) => re.test(f.path)),
    );
    return { kind: "predicate", value: tracked.length > 0 };
  },

  score: { kind: "predicate", direction: "negative" },

  fixtures: [
    {
      name: "none-tracked",
      evidence: {
        size_stats: {
          source: "git-ls-files",
          totalBytes: 10,
          totalFiles: 1,
          files: [{ path: ".claude/settings.json", bytes: 10, lines: 1, depth: 1 }],
        },
      },
      expect: { reading: { kind: "predicate", value: false }, score: 100 },
    },
    {
      name: "local-settings-tracked",
      evidence: {
        size_stats: {
          source: "git-ls-files",
          totalBytes: 10,
          totalFiles: 1,
          files: [{ path: "apps/web/.claude/settings.local.json", bytes: 10, lines: 1, depth: 3 }],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 0 },
    },
  ],
});
