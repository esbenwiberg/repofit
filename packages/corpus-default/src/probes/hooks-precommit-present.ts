import { defineProbe } from "@esbenwiberg/repofit/sdk";

const HOOK_PATHS = [".husky/pre-commit", ".githooks/pre-commit", ".pre-commit-config.yaml"];

export default defineProbe({
  id: "hooks.precommit-present",
  version: "1.0.0",
  dimensions: [{ id: "feedback", weight: 1 }],
  tier: "static",
  evidence: ["files"],

  rationale: `
    A pre-commit hook is local feedback an agent can actually feel: if the
    commit it just made fails the hook, the failure is immediate and
    actionable. Without one, mistakes survive until CI (slower loop) or
    code review (much slower).
  `,

  remediation:
    "Wire a pre-commit hook. Easiest options: `husky` (Node), `pre-commit` (Python — `.pre-commit-config.yaml`), or commit hooks under `.githooks/` + `git config core.hooksPath .githooks`. Run lint/format/test from it.",

  async detect(ev) {
    return { kind: "predicate", value: HOOK_PATHS.some((p) => ev.files.has(p)) };
  },

  score: { kind: "predicate", direction: "positive" },

  fixtures: [
    {
      name: "husky-hook",
      evidence: { files: [".husky/pre-commit"] },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "githooks-hook",
      evidence: { files: [".githooks/pre-commit"] },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "pre-commit-framework",
      evidence: { files: [".pre-commit-config.yaml"] },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "no-hooks",
      evidence: { files: [] },
      expect: { reading: { kind: "predicate", value: false }, score: 0 },
    },
  ],
});
