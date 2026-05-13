import { defineProbe } from "@esbenwiberg/repofit/sdk";

const PROBE_VERSION = "1.0.0";
const MAX_FILES = 5;
const MAX_CHARS_PER_FILE = 4_000;
const MAX_INPUT_CHARS = 20_000;

const SINGLE_FILES = ["ARCHITECTURE.md", "docs/ARCHITECTURE.md", "docs/architecture.md"];
const DIR_ROOTS = ["docs/architecture", "docs/design", "design"];
const MD_FILE = /\.(?:md|markdown)$/i;

const RUBRIC = {
  task: "Judge the project's architecture document(s). Could a coding agent, after reading this material, make a change without violating the system's intended shape?",
  criteria: [
    {
      id: "shape-described",
      description:
        "Does it name the major components, their responsibilities, and how they talk to each other? An overview that lists 'we use Node + Postgres + Redis' without explaining what owns what, or which boundary calls into which, scores low.",
    },
    {
      id: "rules-and-invariants",
      description:
        "Does it state the rules an agent should not break — dependency directions, layer boundaries, what's a public API, what's allowed to import what? A document that describes the code without naming any constraints leaves the agent guessing.",
    },
    {
      id: "current",
      description:
        "Does it match the code as it exists today, or does it describe an aspirational or abandoned version? A doc that names a module no longer present, or omits a major subsystem that's clearly there, is worse than no doc — it actively misleads.",
    },
  ],
} as const;

export default defineProbe({
  id: "arch.doc-quality",
  version: PROBE_VERSION,
  dimensions: [{ id: "context", weight: 1 }],
  tier: "reasoned",
  evidence: ["files", "size_stats", "judge"],

  rationale: `
    arch.doc-present checks for the file. Presence isn't substance: an
    ARCHITECTURE.md can be a stub, or worse, can describe the code as it
    used to be. This probe samples up to five architecture documents and
    asks an LLM whether they describe the current shape, name the rules
    an agent shouldn't break, and stay current with the code. Cached.
  `,

  async detect(ev) {
    const candidates: string[] = [];
    for (const p of SINGLE_FILES) {
      if (ev.files.has(p)) candidates.push(p);
    }
    for (const f of ev.size_stats.files) {
      if (!MD_FILE.test(f.path)) continue;
      if (DIR_ROOTS.some((root) => f.path.startsWith(`${root}/`))) candidates.push(f.path);
    }

    if (candidates.length === 0) {
      return { kind: "na", reason: "no architecture document found" };
    }

    const unique = [...new Set(candidates)].sort();
    const sampled: { path: string; text: string }[] = [];
    let totalChars = 0;
    for (const p of unique) {
      if (sampled.length >= MAX_FILES) break;
      const text = await ev.files.readText(p);
      if (!text) continue;
      const slice = text.slice(0, MAX_CHARS_PER_FILE);
      sampled.push({ path: p, text: slice });
      totalChars += slice.length;
      if (totalChars >= MAX_INPUT_CHARS) break;
    }

    if (sampled.length === 0) {
      return { kind: "na", reason: "architecture documents found but unreadable" };
    }

    const input = sampled.map((s) => `# ${s.path}\n\n${s.text}`).join("\n\n---\n\n");
    const result = await ev.judge.score({
      probeId: "arch.doc-quality",
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
      name: "no-doc",
      evidence: {
        files: [],
        size_stats: { files: [], totalBytes: 0, totalFiles: 0, source: "git-ls-files" },
      },
      expect: { reading: { kind: "na", reason: "no architecture document found" }, score: null },
    },
    {
      name: "strong-doc",
      evidence: {
        files: {
          "ARCHITECTURE.md": "# Architecture\n\nLayers: ui -> service -> db. Never reverse.\n",
        },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 1,
          files: [{ path: "ARCHITECTURE.md", bytes: 100, lines: 10, depth: 0 }],
        },
        judge: {
          score: 80,
          perCriterion: {
            "shape-described": 80,
            "rules-and-invariants": 80,
            current: 80,
          },
          rationale: "Layers named, invariant stated, concise.",
          model: "fixture",
        },
      },
      expect: {
        reading: {
          kind: "judge",
          score: 80,
          perCriterion: {
            "shape-described": 80,
            "rules-and-invariants": 80,
            current: 80,
          },
          rationale: "Layers named, invariant stated, concise.",
          model: "fixture",
        },
        score: 80,
      },
    },
  ],
});
