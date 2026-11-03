import { defineProbe } from "@esbenwiberg/repofit/sdk";
import { readGuidanceParts } from "./_shared/guidance-content.js";

const PROBE_VERSION = "2.0.0";
const MAX_INPUT_CHARS = 20_000;

const RUBRIC = {
  task: "Score the root agent-instruction file(s) of this repository (AGENTS.md / CLAUDE.md / .cursorrules, includes already expanded) as instructions for a coding agent that lands here for the first time. Deterministic probes have already checked size against a budget, that referenced paths, skills and commands exist, and that harness adapters are links or pointers; do not score those. Score what only reading can tell: whether the text is instructions rather than documentation, whether it sets operating boundaries, how it speaks, whether it carries session state as fact, and whether it says how it grows. Judge the actual text; a short file that does these things scores higher than a long one that does not.",
  criteria: [
    {
      id: "instructions-not-documentation",
      description:
        "Is the text telling the agent what to do and where to look (commands to run, files to read first, conventions to follow), or is it describing the project (what it is, what it does, its history, prose that belongs in a README)? Pure description scores 0; an instruction-first file with a sentence of orientation scores high.",
    },
    {
      id: "operating-boundaries",
      description:
        "Does the file set operating boundaries in some Always / Ask first / Never shape, however it is named: what the agent must always do, what it must confirm before doing, and what it must never do? Absent boundaries score 0; a full three-part shape with repository-specific entries scores 100.",
    },
    {
      id: "tone-is-boundaries",
      description:
        "Are rules stated as calm boundaries, or shouted with capitals, bold, repetition, 'CRITICAL', 'NEVER EVER' and threats? Boundaries stated once, plainly, score high; a file whose emphasis escalates because earlier rules were ignored scores low.",
    },
    {
      id: "no-session-state",
      description:
        "Is anything that belongs to one session committed as if it were lasting fact: 'current work', a branch name, 'no tests found', 'we just finished X', a todo list of the day? None scores 100; a file that reads as a diary of past sessions scores 0.",
    },
    {
      id: "admission-discipline",
      description:
        "Does the file say how it grows: what belongs in the root, what goes to a scoped guide, a skill or a document, and who may add rules? A stated admission rule scores high; a root that visibly accumulated every rule anyone ever added, with nothing saying where things go, scores low.",
    },
  ],
} as const;

export default defineProbe({
  id: "agent.guidance-quality",
  version: PROBE_VERSION,
  dimensions: [
    { id: "context", weight: 1 },
    { id: "feedback", weight: 0.3 },
  ],
  tier: "reasoned",
  evidence: ["agent_config", "files", "judge"],

  rationale: `
    Size, resolution and adapter shape are checked deterministically
    (agent.root-budget, agent.references-resolve, agent.commands-resolve,
    agent.harness-adapters-thin). What those cannot see is whether the
    text is instructions at all. The field study's recurring failures
    were a README copied into CLAUDE.md, a root with no Always / Ask first
    / Never shape, rules shouted in capitals because earlier ones were
    ignored, one session's state ("current work", a branch name) committed
    as fact, and a root with no admission rule that grew into a landfill.
    This probe asks a model to judge exactly those five things, told what
    has already been checked so it does not re-score size or paths. The
    result is cached; only a content or probe-version change re-incurs a
    model call.
  `,

  remediation:
    "Make the root an instruction file, not documentation: lead with what to run and where to look, set Always / Ask first / Never boundaries specific to this repository, state each rule once in a plain voice, strip anything that describes one session (current work, branch names, 'no tests found'), and add one line saying what belongs in the root and where everything else goes.",

  async detect(ev) {
    const guidance = ev.agent_config.guidance;
    if (guidance.length === 0) {
      return { kind: "na", reason: "no agent-guidance file present" };
    }

    const parts = (await readGuidanceParts(guidance, ev.files, MAX_INPUT_CHARS)).map(
      (part) => `# ${part.path}\n\n${part.text}`,
    );

    if (parts.length === 0) {
      return { kind: "na", reason: "agent-guidance files declared but unreadable" };
    }

    const facts = guidance.map((g) => `- ${g.path}: ${g.bytes} bytes, ${g.lines} lines`);
    const input = [
      "# ALREADY CHECKED BY DETERMINISTIC PROBES (do not score)",
      "",
      "Size against budget, resolution of referenced paths, skills and commands, and whether harness files are links or pointers.",
      "",
      ...facts,
      "",
      "---",
      "",
      "# ROOT INSTRUCTION FILES (includes expanded)",
      "",
      parts.join("\n\n---\n\n"),
    ].join("\n");

    const result = await ev.judge.score({
      probeId: "agent.guidance-quality",
      probeVersion: PROBE_VERSION,
      input,
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
      name: "no-guidance",
      evidence: { agent_config: { guidance: [] } },
      expect: { reading: { kind: "na", reason: "no agent-guidance file present" }, score: null },
    },
    {
      name: "strong-guidance",
      evidence: {
        agent_config: { guidance: [{ path: "AGENTS.md", bytes: 2000, lines: 80 }] },
        files: {
          "AGENTS.md":
            "# Working here\n\nRun `npm test` before every commit.\n\n## Always / Ask first / Never\n\n- Always: run the typecheck.\n- Ask first: before deleting data.\n- Never: commit secrets.\n\nRules that apply to one package go in that package's AGENTS.md, not here.\n",
        },
        judge: {
          score: 80,
          perCriterion: {
            "instructions-not-documentation": 80,
            "operating-boundaries": 80,
            "tone-is-boundaries": 80,
            "no-session-state": 80,
            "admission-discipline": 80,
          },
          rationale: "Instruction-first with boundaries and an admission rule.",
          model: "fixture",
        },
      },
      expect: {
        reading: {
          kind: "judge",
          score: 80,
          perCriterion: {
            "instructions-not-documentation": 80,
            "operating-boundaries": 80,
            "tone-is-boundaries": 80,
            "no-session-state": 80,
            "admission-discipline": 80,
          },
          rationale: "Instruction-first with boundaries and an admission rule.",
          model: "fixture",
        },
        score: 80,
      },
    },
    {
      name: "weak-guidance",
      evidence: {
        agent_config: { guidance: [{ path: "CLAUDE.md", bytes: 200, lines: 8 }] },
        files: {
          "CLAUDE.md":
            "# Acme\n\nAcme is a web app for widgets. CRITICAL: NEVER EVER break the build!!!\n\nCurrent work: branch feat/login, no tests found yet.\n",
        },
        judge: {
          score: 20,
          perCriterion: {
            "instructions-not-documentation": 20,
            "operating-boundaries": 0,
            "tone-is-boundaries": 20,
            "no-session-state": 0,
            "admission-discipline": 0,
          },
          rationale: "A README fragment, one shouted rule and a session diary.",
          model: "fixture",
        },
      },
      expect: {
        reading: {
          kind: "judge",
          score: 20,
          perCriterion: {
            "instructions-not-documentation": 20,
            "operating-boundaries": 0,
            "tone-is-boundaries": 20,
            "no-session-state": 0,
            "admission-discipline": 0,
          },
          rationale: "A README fragment, one shouted rule and a session diary.",
          model: "fixture",
        },
        score: 20,
      },
    },
  ],
});
