import { defineProbe } from "@esbenwiberg/repofit/sdk";

export default defineProbe({
  id: "agent.guidance-present",
  version: "0.0.0",
  dimensions: [{ id: "context", weight: 1 }],
  tier: "static",
  evidence: ["agent_config"],

  rationale: `
    An agent works dramatically better when it can find guidance files
    (CLAUDE.md, AGENTS.md, .cursorrules, .aider.conf.yml). A repo with
    none of these is invisible to agent priors — every session starts
    from zero context.
  `,

  async detect(ev) {
    return { kind: "predicate", value: ev.agent_config.guidance.length > 0 };
  },

  score: { kind: "predicate", direction: "positive" },

  fixtures: [
    {
      name: "guidance-present",
      evidence: { agent_config: { guidance: [{ path: "CLAUDE.md", bytes: 1024 }] } },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "no-guidance",
      evidence: { agent_config: { guidance: [] } },
      expect: { reading: { kind: "predicate", value: false }, score: 0 },
    },
  ],
});
