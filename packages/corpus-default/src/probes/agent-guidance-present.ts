import { defineProbe } from "@esbenwiberg/repofit/sdk";

export default defineProbe({
  id: "agent.guidance-present",
  version: "1.0.0",
  dimensions: [{ id: "context", weight: 1 }],
  tier: "static",
  evidence: ["agent_config"],

  rationale: `
    An agent works dramatically better when it can find guidance files
    (CLAUDE.md, AGENTS.md, .cursorrules, .aider.conf.yml). A repo with
    none of these is invisible to agent priors — every session starts
    from zero context.
  `,

  remediation:
    "Add a `CLAUDE.md` (or `AGENTS.md`) at the repo root. Cover: what the project is, how to build/test/lint, key conventions, and where to find things. Even 30–50 lines is a huge upgrade over nothing.",

  async detect(ev) {
    return { kind: "predicate", value: ev.agent_config.guidance.length > 0 };
  },

  score: { kind: "predicate", direction: "positive" },

  fixtures: [
    {
      name: "guidance-present",
      evidence: { agent_config: { guidance: [{ path: "CLAUDE.md", bytes: 1024, lines: 30 }] } },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "no-guidance",
      evidence: { agent_config: { guidance: [] } },
      expect: { reading: { kind: "predicate", value: false }, score: 0 },
    },
  ],
});
