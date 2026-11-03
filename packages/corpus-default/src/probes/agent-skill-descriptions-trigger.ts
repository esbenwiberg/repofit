import type { InventoryItem } from "@esbenwiberg/repofit/sdk";
import { defineProbe } from "@esbenwiberg/repofit/sdk";
import { agentFixture } from "./_shared/agent-evidence-fixture.js";
import { basename, distinctSkills } from "./_shared/agent-tree.js";

const DESCRIPTION_MIN = 40;
const DESCRIPTION_MAX = 1024;
const BODY_MAX_LINES = 500;
const TRIGGER_CUE_RE =
  /\buse when\b|\bwhen\s|\buse for\b|\bdon't use\b|\bdo not use\b|\bnot for\b/i;

export default defineProbe({
  id: "agent.skill-descriptions-trigger",
  version: "1.0.0",
  dimensions: [{ id: "context", weight: 1 }],
  tier: "static",
  evidence: ["agent_config"],

  rationale: `
    A harness decides whether to load a skill from its frontmatter alone.
    A description that says what the skill is but not when to reach for it
    is never triggered, and a body of several hundred lines is loaded whole
    once it is. The blueprint the field study converged on: \`name\`
    matches the directory, the description names the trigger ("use
    when ...", "not for ...") in 40–1024 characters, and the body stays
    procedural under 500 lines, with reference material in \`references/\`.
  `,

  remediation:
    "In each `SKILL.md` frontmatter set `name` to the directory name and write a `description` that says when to use the skill and when not to. Move long reference material out of the body into `references/` files the skill points at.",

  async detect(ev) {
    const skills = distinctSkills(ev.agent_config.skills);
    if (skills.length === 0) return { kind: "na", reason: "no skills" };
    const items: InventoryItem[] = [];
    for (const skill of skills) {
      const failed: string[] = [];
      const fm = skill.frontmatter;
      if (!fm) failed.push("no frontmatter");
      else {
        const dir = basename(skill.dir);
        if (!fm.name) failed.push("no name");
        else if (fm.name.trim() !== dir)
          failed.push(`name "${fm.name}" is not the directory "${dir}"`);
        const description = fm.description?.trim() ?? "";
        if (description.length === 0) failed.push("no description");
        else if (description.length < DESCRIPTION_MIN)
          failed.push("description under 40 characters");
        else if (description.length > DESCRIPTION_MAX)
          failed.push("description over 1024 characters");
        else if (!TRIGGER_CUE_RE.test(description))
          failed.push("description does not say when to use it");
      }
      if (skill.bodyLines >= BODY_MAX_LINES) failed.push(`body is ${skill.bodyLines} lines`);
      if (failed.length > 0) {
        items.push({
          location: { path: skill.path },
          severity: "warn",
          message: failed.join("; "),
        });
      }
    }
    return { kind: "inventory", items };
  },

  score: {
    kind: "inventory",
    severityWeights: { info: 0, warn: 1, error: 1 },
    bands: [{ upTo: 0, score: 100 }, { upTo: 1, score: 80 }, { upTo: 3, score: 50 }, { score: 20 }],
  },

  fixtures: [
    {
      name: "no-skills",
      evidence: agentFixture({ files: {} }),
      expect: { reading: { kind: "na", reason: "no skills" }, score: null },
    },
    {
      name: "conforming",
      evidence: agentFixture({
        files: {
          ".agents/skills/commit/SKILL.md":
            "---\nname: commit\ndescription: Use when committing a checkpoint; not for release tagging.\n---\n\n1. Stage.\n2. Commit.\n",
        },
      }),
      expect: { reading: { kind: "inventory", items: [] }, score: 100 },
    },
    {
      name: "every-rule-broken-once",
      evidence: agentFixture({
        files: {
          ".agents/skills/a/SKILL.md": "---\nname: alpha\ndescription: Short.\n---\nbody\n",
          ".agents/skills/b/SKILL.md": `---\nname: b\ndescription: A long enough description of what this skill does in detail.\n---\n${"line\n".repeat(500)}`,
          ".agents/skills/c/SKILL.md": "no frontmatter at all\n",
        },
      }),
      expect: {
        reading: {
          kind: "inventory",
          items: [
            {
              location: { path: ".agents/skills/a/SKILL.md" },
              severity: "warn",
              message: 'name "alpha" is not the directory "a"; description under 40 characters',
            },
            {
              location: { path: ".agents/skills/b/SKILL.md" },
              severity: "warn",
              message: "description does not say when to use it; body is 500 lines",
            },
            {
              location: { path: ".agents/skills/c/SKILL.md" },
              severity: "warn",
              message: "no frontmatter",
            },
          ],
        },
        score: 50,
      },
    },
  ],
});
