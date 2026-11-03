import { defineProbe } from "@esbenwiberg/repofit/sdk";
import { agentFixture } from "./_shared/agent-evidence-fixture.js";
import { distinctSkills } from "./_shared/agent-tree.js";

const SKILL = (name: string) => `---\nname: ${name}\ndescription: Use when ${name}.\n---\nbody\n`;

export default defineProbe({
  id: "agent.skill-evals-present",
  version: "1.0.0",
  optIn: true,
  dimensions: [{ id: "feedback", weight: 0.5 }],
  tier: "static",
  evidence: ["agent_config"],

  rationale: `
    A skill is a claim that the agent does better with it than without. An
    \`evals/\` directory beside the skill is the only artefact that lets
    anyone check the claim after the skill changes. The practice is young
    (the field study found it in 4 of 55 repositories), so this probe is
    opt-in: list its id under \`gate.include\` to score it.
  `,

  remediation:
    "Add an `evals/` directory to each skill with at least one case the skill must pass: the prompt, the expected behaviour and, ideally, the failure seen without the skill.",

  async detect(ev) {
    const skills = distinctSkills(ev.agent_config.skills);
    if (skills.length === 0) return { kind: "na", reason: "no skills" };
    const withEvals = skills.filter((s) => s.hasEvals).length;
    return { kind: "magnitude", value: Math.round((100 * withEvals) / skills.length), unit: "%" };
  },

  score: {
    kind: "magnitude",
    direction: "positive",
    bands: [
      { upTo: 0, score: 0 },
      { upTo: 24, score: 40 },
      { upTo: 49, score: 70 },
      { score: 100 },
    ],
  },

  fixtures: [
    {
      name: "no-skills",
      evidence: agentFixture({ files: {} }),
      expect: { reading: { kind: "na", reason: "no skills" }, score: null },
    },
    {
      name: "none-evaluated",
      evidence: agentFixture({ files: { ".agents/skills/a/SKILL.md": SKILL("a") } }),
      expect: { reading: { kind: "magnitude", value: 0, unit: "%" }, score: 0 },
    },
    {
      name: "one-of-three",
      evidence: agentFixture({
        files: {
          ".agents/skills/a/SKILL.md": SKILL("a"),
          ".agents/skills/a/evals/case-1.md": "prompt\n",
          ".agents/skills/b/SKILL.md": SKILL("b"),
          ".agents/skills/c/SKILL.md": SKILL("c"),
        },
      }),
      expect: { reading: { kind: "magnitude", value: 33, unit: "%" }, score: 70 },
    },
    {
      name: "half-evaluated",
      evidence: agentFixture({
        files: {
          ".agents/skills/a/SKILL.md": SKILL("a"),
          ".agents/skills/a/evals/case-1.md": "prompt\n",
          ".agents/skills/b/SKILL.md": SKILL("b"),
        },
      }),
      expect: { reading: { kind: "magnitude", value: 50, unit: "%" }, score: 100 },
    },
  ],
});
