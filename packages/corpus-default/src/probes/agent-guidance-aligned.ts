import { defineProbe } from "@esbenwiberg/repofit/sdk";
import { isPointer } from "./_shared/agent-tree.js";

const PROBE_VERSION = "1.1.0";
const MAX_CHARS_PER_FILE = 5_000;
const MAX_INPUT_CHARS = 20_000;

const RUBRIC = {
  task: "Judge whether the root agent guidance files of this repository give different agents the same instructions. Only real parallels are shown: files that are symlinks to another guidance file, or that contain nothing but an @include pointer, were excluded because a deterministic probe already verified them. Compare the files shown on what they tell an agent to do; wording may differ, instructions must not.",
  criteria: [
    {
      id: "commands-align",
      description:
        "Do build, test, lint, typecheck, smoke, and release commands match across guidance files? Contradictory commands score low.",
    },
    {
      id: "architecture-align",
      description:
        "Do the files describe the same repo structure, package ownership, and architectural boundaries?",
    },
    {
      id: "conventions-align",
      description: "Do coding, commit, review, testing, and safety conventions agree across files?",
    },
    {
      id: "audience-fit",
      description:
        "Do tool-specific files add appropriate local nuance without forking the source of truth or drifting from shared guidance?",
    },
  ],
} as const;

export default defineProbe({
  id: "agent.guidance-aligned",
  version: PROBE_VERSION,
  dimensions: [
    { id: "context", weight: 1 },
    { id: "consistency", weight: 0.7 },
  ],
  tier: "reasoned",
  evidence: ["agent_config", "files", "judge"],

  rationale: `
    Many repos carry several root guidance files: CLAUDE.md, AGENTS.md,
    .cursorrules, Copilot instructions. Where those are symlinks or
    one-line pointers to a canonical file, agent.harness-adapters-thin
    already proves they cannot drift, so this probe leaves them out and
    compares only real parallels: files with their own content. Two such
    files are useful only if they agree on commands, architecture,
    conventions and safety rules; otherwise different agents receive
    different realities.
  `,

  remediation:
    "Pick one source of truth for shared repo guidance, then make tool-specific files a symlink to it or a one-line `@AGENTS.md` pointer. Where a harness really needs its own content, keep commands, architecture, commit rules, testing expectations and safety constraints identical to the canonical file.",

  async detect(ev) {
    const guidance = ev.agent_config.guidance;
    if (guidance.length < 2) {
      return { kind: "na", reason: "fewer than two agent guidance files found" };
    }

    const linked = new Set(
      ev.agent_config.instructionFiles.filter((f) => f.link !== null).map((f) => f.path),
    );
    const sampled: { path: string; text: string }[] = [];
    let totalChars = 0;
    for (const g of [...guidance].sort((a, b) => a.path.localeCompare(b.path))) {
      if (linked.has(g.path)) continue;
      const text = await ev.files.readText(g.path);
      if (!text || isPointer(text)) continue;
      const slice = text.slice(0, MAX_CHARS_PER_FILE);
      sampled.push({ path: g.path, text: slice });
      totalChars += slice.length;
      if (totalChars >= MAX_INPUT_CHARS) break;
    }

    if (sampled.length < 2) {
      return { kind: "na", reason: "fewer than two guidance files with their own content" };
    }

    const input = sampled.map((s) => `# ${s.path}\n\n${s.text}`).join("\n\n---\n\n");
    const result = await ev.judge.score({
      probeId: "agent.guidance-aligned",
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
      name: "single-guidance-file",
      evidence: { agent_config: { guidance: [{ path: "CLAUDE.md", bytes: 100, lines: 5 }] } },
      expect: {
        reading: { kind: "na", reason: "fewer than two agent guidance files found" },
        score: null,
      },
    },
    {
      name: "pointer-and-link-adapters-are-not-parallels",
      evidence: {
        agent_config: {
          guidance: [
            { path: "AGENTS.md", bytes: 200, lines: 10 },
            { path: "CLAUDE.md", bytes: 10, lines: 1 },
            { path: "GEMINI.md", bytes: 200, lines: 10 },
          ],
          instructionFiles: [
            {
              path: "AGENTS.md",
              depth: 0,
              bytes: 200,
              lines: 10,
              sha256: "a",
              link: null,
              includes: [],
            },
            {
              path: "CLAUDE.md",
              depth: 0,
              bytes: 10,
              lines: 1,
              sha256: "b",
              link: null,
              includes: ["AGENTS.md"],
            },
            {
              path: "GEMINI.md",
              depth: 0,
              bytes: 200,
              lines: 10,
              sha256: "a",
              link: { target: "AGENTS.md", targetExists: true, insideRepo: true },
              includes: [],
            },
          ],
        },
        files: {
          "AGENTS.md": "Run npm test. Commit as feat(scope): subject.\n",
          "CLAUDE.md": "@AGENTS.md\n",
          "GEMINI.md": "Run npm test. Commit as feat(scope): subject.\n",
        },
      },
      expect: {
        reading: { kind: "na", reason: "fewer than two guidance files with their own content" },
        score: null,
      },
    },
    {
      name: "aligned-guidance",
      evidence: {
        agent_config: {
          guidance: [
            { path: "AGENTS.md", bytes: 200, lines: 10 },
            { path: ".github/copilot-instructions.md", bytes: 200, lines: 10 },
          ],
        },
        files: {
          "AGENTS.md": "Run npm test and npm run typecheck. Commit as feat(scope): subject.\n",
          ".github/copilot-instructions.md":
            "Follow AGENTS.md. Use npm test and npm run typecheck before proposing changes.\n",
        },
        judge: {
          score: 80,
          perCriterion: {
            "commands-align": 80,
            "architecture-align": 80,
            "conventions-align": 80,
            "audience-fit": 80,
          },
          rationale: "Copilot instructions defer to AGENTS.md and repeat the same commands.",
          model: "fixture",
        },
      },
      expect: {
        reading: {
          kind: "judge",
          score: 80,
          perCriterion: {
            "commands-align": 80,
            "architecture-align": 80,
            "conventions-align": 80,
            "audience-fit": 80,
          },
          rationale: "Copilot instructions defer to AGENTS.md and repeat the same commands.",
          model: "fixture",
        },
        score: 80,
      },
    },
  ],
});
