import { defineProbe } from "@esbenwiberg/repofit/sdk";

const PROBE_VERSION = "1.0.0";
const MAX_INPUT_CHARS = 20_000;

const RUBRIC = {
  task: "Score the project's README on how useful it would be to a coding agent landing in this repository for the first time and trying to orient itself.",
  criteria: [
    {
      id: "purpose-clear",
      description:
        "After reading the first few paragraphs, can you state what this project is and who it's for? A README that buries or omits the purpose forces the agent to infer it from filenames.",
    },
    {
      id: "entry-points",
      description:
        "Does it name the entry points — how to install, how to build, how to test, how to run — with concrete commands the agent could copy-paste? Vague language ('use your favorite package manager') is worse than nothing.",
    },
    {
      id: "actionable",
      description:
        "Are commands and paths real (they match what's actually in the repo) and current (not referring to renamed scripts, removed files, or old versions)? An out-of-date README is a trap.",
    },
    {
      id: "scope",
      description:
        "Does the README cover the essentials without drowning the reader? A 2000-line README is a navigation problem; a one-line README is a coverage problem. Aim for: purpose, install, basic usage, where the docs live.",
    },
  ],
} as const;

export default defineProbe({
  id: "docs.readme-clarity",
  version: PROBE_VERSION,
  dimensions: [{ id: "context", weight: 1 }],
  tier: "reasoned",
  evidence: ["files", "judge"],

  rationale: `
    docs.readme-substance counts canonical headings; presence of "## Install"
    doesn't mean the install instructions are usable. This probe asks an LLM
    to judge the README against four criteria: purpose clarity, entry-point
    coverage, actionability of commands, and scope balance. Cached, so a
    clean run is free; only changes to README content (or the probe version)
    re-incur a model call.
  `,

  async detect(ev) {
    const raw = await ev.files.readText("README.md");
    if (raw === undefined) {
      return { kind: "na", reason: "no README.md" };
    }
    if (raw.trim().length === 0) {
      return { kind: "na", reason: "README.md is empty" };
    }

    const input = `# README.md\n\n${raw.slice(0, MAX_INPUT_CHARS)}`;
    const result = await ev.judge.score({
      probeId: "docs.readme-clarity",
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
      name: "no-readme",
      evidence: { files: {} },
      expect: { reading: { kind: "na", reason: "no README.md" }, score: null },
    },
    {
      name: "strong-readme",
      evidence: {
        files: {
          "README.md":
            "# proj\n\nA CLI that does X.\n\n## Install\n\nnpm install\n\n## Usage\n\nproj run\n",
        },
        judge: {
          score: 80,
          perCriterion: { "purpose-clear": 80, "entry-points": 80, actionable: 80, scope: 80 },
          rationale: "Clear purpose, concrete commands, well-scoped.",
          model: "fixture",
        },
      },
      expect: {
        reading: {
          kind: "judge",
          score: 80,
          perCriterion: { "purpose-clear": 80, "entry-points": 80, actionable: 80, scope: 80 },
          rationale: "Clear purpose, concrete commands, well-scoped.",
          model: "fixture",
        },
        score: 80,
      },
    },
    {
      name: "stub-readme",
      evidence: {
        files: { "README.md": "# proj\n\nA cool thing.\n" },
        judge: {
          score: 20,
          perCriterion: { "purpose-clear": 20, "entry-points": 0, actionable: 0, scope: 20 },
          rationale: "Stub — no entry points, no actionable commands.",
          model: "fixture",
        },
      },
      expect: {
        reading: {
          kind: "judge",
          score: 20,
          perCriterion: { "purpose-clear": 20, "entry-points": 0, actionable: 0, scope: 20 },
          rationale: "Stub — no entry points, no actionable commands.",
          model: "fixture",
        },
        score: 20,
      },
    },
  ],
});
