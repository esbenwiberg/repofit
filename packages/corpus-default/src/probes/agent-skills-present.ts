import { defineProbe } from "@esbenwiberg/repofit/sdk";
import { agentFixture } from "./_shared/agent-evidence-fixture.js";
import { distinctSkills } from "./_shared/agent-tree.js";

const SKILL = "---\nname: commit\ndescription: Use when committing work.\n---\n\nSteps.\n";

export default defineProbe({
  id: "agent.skills-present",
  version: "2.0.0",
  dimensions: [
    { id: "context", weight: 1 },
    { id: "feedback", weight: 0.3 },
  ],
  tier: "static",
  evidence: ["agent_config"],

  rationale: `
    Repository-local skills turn recurring agent work into reusable
    procedures: commit workflow, release, review, debugging a failing CI
    run. Guidance says what matters; a skill gives a repeatable path
    through a high-friction task. Skills are counted once each: a
    \`.claude/skills\` link onto \`.agents/skills\` and a byte-identical
    copy in a second root are the same skill, not two.
  `,

  remediation:
    "Add skills for repeated workflows under `.agents/skills/<name>/SKILL.md` (the shared location) and expose them to harnesses that read their own directory with a link such as `.claude/skills -> ../.agents/skills`. Good starting points: `commit`, `release`, `review`, `debug-failing-ci`.",

  async detect(ev) {
    const samples = distinctSkills(ev.agent_config.skills).map((s) => ({ path: s.path }));
    return { kind: "count", value: samples.length, samples };
  },

  score: {
    kind: "count",
    direction: "positive",
    bands: [{ upTo: 0, score: 0 }, { upTo: 1, score: 60 }, { upTo: 3, score: 80 }, { score: 100 }],
  },

  fixtures: [
    {
      name: "no-skills",
      evidence: agentFixture({ files: { "AGENTS.md": "# root\n" } }),
      expect: { reading: { kind: "count", value: 0, samples: [] }, score: 0 },
    },
    {
      name: "linked-root-and-copy-count-once",
      evidence: agentFixture({
        files: {
          ".agents/skills/commit/SKILL.md": SKILL,
          ".agents/skills/release/SKILL.md": SKILL.replace("commit", "release"),
          ".codex/skills/commit/SKILL.md": SKILL,
        },
        links: { ".claude/skills": "../.agents/skills" },
      }),
      expect: {
        reading: {
          kind: "count",
          value: 2,
          samples: [
            { path: ".agents/skills/commit/SKILL.md" },
            { path: ".agents/skills/release/SKILL.md" },
          ],
        },
        score: 80,
      },
    },
    {
      name: "four-distinct-skills",
      evidence: agentFixture({
        files: Object.fromEntries(
          ["a", "b", "c", "d"].map((n) => [
            `.agents/skills/${n}/SKILL.md`,
            SKILL.replace("commit", n),
          ]),
        ),
      }),
      expect: {
        reading: {
          kind: "count",
          value: 4,
          samples: ["a", "b", "c", "d"].map((n) => ({ path: `.agents/skills/${n}/SKILL.md` })),
        },
        score: 100,
      },
    },
  ],
});
