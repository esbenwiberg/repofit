import { defineProbe } from "@esbenwiberg/repofit/sdk";
import { readGuidanceParts } from "./_shared/guidance-content.js";

const PROBE_VERSION = "1.1.0";
const MAX_INPUT_CHARS = 20_000;

const RUBRIC = {
  task: "Score the agent-guidance file (CLAUDE.md / AGENTS.md / .cursorrules) on how useful it would be to a coding agent landing in this repository for the first time.",
  criteria: [
    {
      id: "specific",
      description:
        "Does the content describe THIS project in concrete terms (paths, commands, naming conventions, real constraints), or is it generic platitudes like 'write clean code' and 'follow best practices'?",
    },
    {
      id: "actionable",
      description:
        "If the agent reads only this file, can it take correct action (run the right command, edit the right file, follow the right convention) without further trial and error?",
    },
    {
      id: "coverage",
      description:
        "Does it cover the essentials: how to build, how to test, how to run, and where the major code lives? Missing any of these costs points; missing all four is a 0.",
    },
    {
      id: "project-fit",
      description:
        "Does the guidance reflect what's actually in the repo (real paths, real scripts, real conventions), or does it look like a generic template never tailored to this codebase?",
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
    Length is a crude proxy for guidance quality (see agent.root-budget).
    A 200-line CLAUDE.md full of generic platitudes is worse than a 30-line
    one that names the actual build command. This probe asks an LLM to judge
    the guidance file against four criteria: specificity, actionability,
    coverage of build/test/run/architecture, and project-fit. The result is
    cached so a clean run is free; only changes to guidance content (or the
    probe version) re-incur a model call.
  `,

  remediation:
    "Make your CLAUDE.md/AGENTS.md specific to THIS project: real paths, real commands, real conventions. Cover build, test, run, and where the major code lives. Generic platitudes ('write clean code') score poorly; concrete project-specific instructions score well. Tip: include the exact commands an agent should run for typecheck, test, lint, and dev server.",

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

    const combined = parts.join("\n\n---\n\n");
    const result = await ev.judge.score({
      probeId: "agent.guidance-quality",
      probeVersion: PROBE_VERSION,
      input: combined,
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
        agent_config: { guidance: [{ path: "CLAUDE.md", bytes: 2000, lines: 80 }] },
        files: { "CLAUDE.md": "# Project\n\nReal, specific guidance with concrete paths." },
        judge: {
          score: 80,
          perCriterion: { specific: 80, actionable: 80, coverage: 80, "project-fit": 80 },
          rationale: "Concrete, project-specific, covers the essentials.",
          model: "fixture",
        },
      },
      expect: {
        reading: {
          kind: "judge",
          score: 80,
          perCriterion: { specific: 80, actionable: 80, coverage: 80, "project-fit": 80 },
          rationale: "Concrete, project-specific, covers the essentials.",
          model: "fixture",
        },
        score: 80,
      },
    },
    {
      name: "weak-guidance",
      evidence: {
        agent_config: { guidance: [{ path: "CLAUDE.md", bytes: 200, lines: 8 }] },
        files: { "CLAUDE.md": "Write clean code. Follow best practices." },
        judge: {
          score: 20,
          perCriterion: { specific: 20, actionable: 20, coverage: 0, "project-fit": 20 },
          rationale: "Generic platitudes; no project-specific content.",
          model: "fixture",
        },
      },
      expect: {
        reading: {
          kind: "judge",
          score: 20,
          perCriterion: { specific: 20, actionable: 20, coverage: 0, "project-fit": 20 },
          rationale: "Generic platitudes; no project-specific content.",
          model: "fixture",
        },
        score: 20,
      },
    },
  ],
});
