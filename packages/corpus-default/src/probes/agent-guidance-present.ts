import { defineProbe } from "@esbenwiberg/repofit/sdk";
import { agentFixture } from "./_shared/agent-evidence-fixture.js";

/** Rule collections a harness reads from the root without a single root file. */
const ROOT_RULE_COLLECTIONS = /^(?:\.cursor\/rules|\.github\/instructions|\.claude\/rules)\/[^/]+$/;

export default defineProbe({
  id: "agent.guidance-present",
  version: "2.0.0",
  dimensions: [{ id: "context", weight: 1 }],
  tier: "static",
  evidence: ["agent_config"],

  rationale: `
    An agent works dramatically better when it can find guidance at the
    root: AGENTS.md, CLAUDE.md, GEMINI.md, .cursorrules, .aider.conf.yml,
    .github/copilot-instructions.md, or a rule collection under
    .cursor/rules, .github/instructions or .claude/rules. A repo with none
    of these is invisible to agent priors; every session starts from zero.
  `,

  remediation:
    "Add an `AGENTS.md` at the repo root (harnesses that read `CLAUDE.md` or `GEMINI.md` can symlink or `@AGENTS.md`-include it). Cover: what the project is, how to build/test/lint, key conventions, and where to find things. Even 30–50 lines is a huge upgrade over nothing.",

  async detect(ev) {
    const present =
      ev.agent_config.guidance.length > 0 ||
      ev.agent_config.instructionFiles.some((f) => ROOT_RULE_COLLECTIONS.test(f.path));
    return { kind: "predicate", value: present };
  },

  score: { kind: "predicate", direction: "positive" },

  fixtures: [
    {
      name: "guidance-present",
      evidence: { agent_config: { guidance: [{ path: "CLAUDE.md", bytes: 1024, lines: 30 }] } },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "rule-collection-only",
      evidence: agentFixture({ files: { ".cursor/rules/testing.mdc": "Run the tests.\n" } }),
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "nested-only-is-not-root-guidance",
      evidence: agentFixture({ files: { "packages/a/AGENTS.md": "# a\n" } }),
      expect: { reading: { kind: "predicate", value: false }, score: 0 },
    },
    {
      name: "no-guidance",
      evidence: { agent_config: { guidance: [] } },
      expect: { reading: { kind: "predicate", value: false }, score: 0 },
    },
  ],
});
