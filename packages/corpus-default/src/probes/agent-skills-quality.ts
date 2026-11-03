import { defineProbe } from "@esbenwiberg/repofit/sdk";
import { agentFixture } from "./_shared/agent-evidence-fixture.js";
import { distinctSkills, skillName, stripFrontmatter } from "./_shared/agent-tree.js";

const PROBE_VERSION = "2.0.0";
const MAX_SKILLS = 5;
const MAX_CHARS_PER_SKILL = 3_000;
const MAX_INPUT_CHARS = 18_000;

const RUBRIC = {
  task: "Judge whether the repository's local skills (SKILL.md files) would make a coding agent perform a repeated workflow correctly. Deterministic probes have already checked that each skill has frontmatter, that its description carries a trigger cue, that its body is within size, and whether it has evals/ and references/ directories; do not score those. Each skill is shown with the description its frontmatter promises and the body that must deliver it. Score what only reading can tell.",
  criteria: [
    {
      id: "body-delivers-description",
      description:
        "Does the body teach what the description promises? A description that announces a workflow whose body is a stub, a list of links, or something else entirely scores 0; a body that does exactly what the description says, no more, scores 100.",
    },
    {
      id: "procedural-not-encyclopaedic",
      description:
        "Is the body a procedure (ordered steps, the commands to run, the files to touch, the signals that each step worked) rather than a manual? Reference material belongs in references/ and is loaded on demand; a body that reads as documentation scores low.",
    },
    {
      id: "failure-prevented-stated",
      description:
        "Does the skill say which failure it prevents: what an agent gets wrong without it? A skill that names the mistake and the signal that it happened scores high; one that cannot say why it exists scores 0.",
    },
    {
      id: "repo-fit",
      description:
        "Is the skill specific to this repository's structure, tools, conventions and hazards rather than reusable platitudes? Generic advice scores low.",
    },
  ],
} as const;

export default defineProbe({
  id: "agent.skills-quality",
  version: PROBE_VERSION,
  dimensions: [
    { id: "context", weight: 1 },
    { id: "feedback", weight: 0.5 },
  ],
  tier: "reasoned",
  evidence: ["agent_config", "files", "judge"],

  rationale: `
    Frontmatter, trigger cues, body size and the presence of evals/ and
    references/ are checked deterministically (agent.skill-descriptions-
    trigger, agent.skill-evals-present). What those cannot see is whether
    the body delivers what the description promises, whether it is a
    procedure or a manual, and whether the author can say which failure
    the skill prevents. The field study's best skills were written after
    watching an agent fail without them and say so; the worst were
    README chapters with a name. This probe samples the distinct skills
    (links collapsed) and asks a model exactly those questions.
  `,

  remediation:
    "Turn each skill into a procedure that delivers its description: name the failure it prevents, give ordered steps with exact commands, files and the signal that each step worked, and move reference material into references/. Delete skills whose only content is a pointer or a summary of the README.",

  async detect(ev) {
    const skills = distinctSkills(ev.agent_config.skills);
    if (skills.length === 0) {
      return { kind: "na", reason: "no local agent skills found" };
    }

    const sampled: string[] = [];
    let totalChars = 0;
    for (const skill of skills) {
      if (sampled.length >= MAX_SKILLS) break;
      const text = await ev.files.readText(skill.path);
      if (!text) continue;
      const body = stripFrontmatter(text).slice(0, MAX_CHARS_PER_SKILL);
      const description = skill.frontmatter?.description?.trim() || "(no description)";
      const facts = `- name: ${skillName(skill)}\n- description: ${description}\n- references/: ${skill.hasReferences ? "present" : "absent"}\n- evals/: ${skill.hasEvals ? "present" : "absent"}`;
      sampled.push(`# ${skill.path}\n\n${facts}\n\n## Body\n\n${body}`);
      totalChars += body.length;
      if (totalChars >= MAX_INPUT_CHARS) break;
    }

    if (sampled.length === 0) {
      return { kind: "na", reason: "local agent skills declared but unreadable" };
    }

    const result = await ev.judge.score({
      probeId: "agent.skills-quality",
      probeVersion: PROBE_VERSION,
      input: sampled.join("\n\n---\n\n"),
      rubric: RUBRIC,
    });

    return {
      kind: "judge",
      score: result.score,
      perCriterion: result.perCriterion,
      rationale: result.rationale,
      model: result.model,
    };
  },

  score: { kind: "judge" },

  fixtures: [
    {
      name: "no-skills",
      evidence: agentFixture({ files: { "CLAUDE.md": "hi\n" } }),
      expect: { reading: { kind: "na", reason: "no local agent skills found" }, score: null },
    },
    {
      name: "strong-skill",
      evidence: {
        ...agentFixture({
          files: {
            ".agents/skills/new-probe/SKILL.md":
              "---\nname: new-probe\ndescription: Use when adding a corpus probe; prevents a probe shipped without fixtures.\n---\n# New Probe\n\nWithout this, probes land with no N/A fixture and break the first repo that lacks the evidence.\n\n1. Add `packages/corpus-default/src/probes/<id>.ts`.\n2. Add fixtures covering N/A, pass, and fail.\n3. Wire it in `src/index.ts`.\n4. Run `npm --workspace @esbenwiberg/corpus-default test`; all fixtures pass.\n5. Commit with `feat(corpus): ...`.\n",
          },
        }),
        judge: {
          score: 80,
          perCriterion: {
            "body-delivers-description": 80,
            "procedural-not-encyclopaedic": 80,
            "failure-prevented-stated": 80,
            "repo-fit": 80,
          },
          rationale: "Procedure matches the description and names the failure it prevents.",
          model: "fixture",
        },
      },
      expect: {
        reading: {
          kind: "judge",
          score: 80,
          perCriterion: {
            "body-delivers-description": 80,
            "procedural-not-encyclopaedic": 80,
            "failure-prevented-stated": 80,
            "repo-fit": 80,
          },
          rationale: "Procedure matches the description and names the failure it prevents.",
          model: "fixture",
        },
        score: 80,
      },
    },
  ],
});
