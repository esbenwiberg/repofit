import { defineProbe } from "@esbenwiberg/repofit/sdk";

const PROBE_VERSION = "1.0.0";
const MAX_SPECS = 4;
const MAX_CHARS_PER_SPEC = 4_000;
const MAX_INPUT_CHARS = 18_000;

const SPEC_DIRS = [
  "specs",
  "spec",
  ".specify",
  "docs/specs",
  "docs/features",
  "features",
  ".features",
  "rfcs",
  "docs/rfcs",
];

const SPEC_FILE = /\.(?:md|markdown)$/i;

const RUBRIC = {
  task: "Judge whether the feature specs in this repo would let a coding agent build a feature correctly without further back-and-forth — and whether they'd recognize when the agent's work is done.",
  criteria: [
    {
      id: "description",
      description:
        "Does each spec actually describe what's being built — the user-facing behaviour, who it's for, what problem it solves? A title and one-liner score low; a clear narrative of the feature scores high.",
    },
    {
      id: "design",
      description:
        "Is there a design section — data shape, API surface, key flows, UI sketch or wireframe reference, integration points? Specs that jump straight from 'add a search bar' to 'tests' miss the place where ambiguity hides.",
    },
    {
      id: "acceptance",
      description:
        "Are there acceptance criteria or test cases — concrete, checkable statements the agent (and reviewer) can verify? Vague 'works well' / 'feels nice' criteria score low; a numbered list of 'when X then Y' statements scores high.",
    },
    {
      id: "consistency",
      description:
        "Do the spec files follow a recognisable shape — same headings, similar level of detail — or do they look like ad-hoc notes from different authors? Consistency is what lets the agent know which section to write into when adding a new feature.",
    },
  ],
} as const;

export default defineProbe({
  id: "specs.quality",
  version: PROBE_VERSION,
  dimensions: [{ id: "context", weight: 1 }],
  tier: "reasoned",
  evidence: ["files", "size_stats", "judge"],

  rationale: `
    specs.present checks that a specs/ folder exists with at least one
    file. It can't tell whether those files are actual feature specs
    (description + design + acceptance criteria) or empty templates. This
    probe samples up to four specs and asks an LLM whether they describe
    what to build, how, and how to know when it's done. Cached.
  `,

  async detect(ev) {
    const specPaths: string[] = [];
    for (const f of ev.size_stats.files) {
      if (!SPEC_FILE.test(f.path)) continue;
      if (SPEC_DIRS.some((dir) => f.path.startsWith(`${dir}/`))) {
        specPaths.push(f.path);
      }
    }

    if (specPaths.length === 0) {
      return { kind: "na", reason: "no feature specs found" };
    }

    const sorted = [...new Set(specPaths)].sort();
    const sampled: { path: string; text: string }[] = [];
    let totalChars = 0;
    for (const p of sorted) {
      if (sampled.length >= MAX_SPECS) break;
      const text = await ev.files.readText(p);
      if (!text) continue;
      const slice = text.slice(0, MAX_CHARS_PER_SPEC);
      sampled.push({ path: p, text: slice });
      totalChars += slice.length;
      if (totalChars >= MAX_INPUT_CHARS) break;
    }

    if (sampled.length === 0) {
      return { kind: "na", reason: "spec files declared but unreadable" };
    }

    const input = sampled.map((s) => `# ${s.path}\n\n${s.text}`).join("\n\n---\n\n");
    const result = await ev.judge.score({
      probeId: "specs.quality",
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
      name: "no-specs",
      evidence: {
        files: [],
        size_stats: { files: [], totalBytes: 0, totalFiles: 0, source: "git-ls-files" },
      },
      expect: { reading: { kind: "na", reason: "no feature specs found" }, score: null },
    },
    {
      name: "strong-specs",
      evidence: {
        files: {
          "specs/login.md":
            "# Login\n\n## Problem\nUsers can't sign in.\n## Design\nForm + POST /login.\n## Acceptance\n- given valid creds, returns 200.\n",
        },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 200,
          totalFiles: 2,
          files: [
            { path: "specs", bytes: 0, lines: 0, depth: 0 },
            { path: "specs/login.md", bytes: 200, lines: 15, depth: 1 },
          ],
        },
        judge: {
          score: 80,
          perCriterion: {
            description: 80,
            design: 80,
            acceptance: 80,
            consistency: 80,
          },
          rationale: "Problem stated, design sketched, acceptance criteria concrete.",
          model: "fixture",
        },
      },
      expect: {
        reading: {
          kind: "judge",
          score: 80,
          perCriterion: {
            description: 80,
            design: 80,
            acceptance: 80,
            consistency: 80,
          },
          rationale: "Problem stated, design sketched, acceptance criteria concrete.",
          model: "fixture",
        },
        score: 80,
      },
    },
  ],
});
