import { defineProbe } from "@esbenwiberg/repofit/sdk";

const PROBE_VERSION = "1.0.0";
const MAX_ADRS = 5;
const MAX_CHARS_PER_ADR = 3_000;
const MAX_INPUT_CHARS = 18_000;

const ADR_DIRS = ["docs/adr/", "doc/adr/", "adr/", "decisions/", "docs/decisions/"];
const ADR_FILE = /\.(?:md|markdown)$/i;

const RUBRIC = {
  task: "Judge the substance of these Architecture Decision Records. Are they recording real decisions in a form an agent could learn from, or are they templates with the slots empty?",
  criteria: [
    {
      id: "decision-stated",
      description:
        "Does each ADR actually state a decision? A good ADR names what was chosen, what the alternatives were, and which one won. A 'Status: Proposed — TBD' ADR doesn't count; nor does an ADR that lists alternatives without picking one.",
    },
    {
      id: "rationale-clear",
      description:
        "Does the ADR explain *why* — the constraint, the tradeoff, or the past incident that drove the call? Without rationale an agent can't tell whether a change is safe to revisit. Bullet lists of pros/cons with no synthesis count for less than a paragraph that names the binding constraint.",
    },
    {
      id: "current-and-living",
      description:
        "Do the ADRs feel maintained — statuses meaningful (Accepted / Superseded / Deprecated with a pointer), dates present, content matching how the code actually works today? A folder of accepted-but-untrue ADRs is a trap; the agent will follow them and be wrong.",
    },
  ],
} as const;

export default defineProbe({
  id: "docs.adr-quality",
  version: PROBE_VERSION,
  dimensions: [{ id: "context", weight: 1 }],
  tier: "reasoned",
  evidence: ["files", "size_stats", "judge"],

  rationale: `
    docs.adr-presence counts files. An ADR folder can hit the count
    without recording any real decisions — templates with empty slots,
    "TBD" statuses, lists of alternatives with no choice. This probe
    samples a few ADRs and asks an LLM whether they describe actual
    decisions, with rationale, that are still current. Cached.
  `,

  async detect(ev) {
    const adrPaths = ev.size_stats.files
      .map((f) => f.path)
      .filter((p) => ADR_DIRS.some((d) => p.startsWith(d)) && ADR_FILE.test(p))
      .sort();

    if (adrPaths.length === 0) {
      return { kind: "na", reason: "no ADRs found" };
    }

    const sampled: { path: string; text: string }[] = [];
    let totalChars = 0;
    for (const p of adrPaths) {
      if (sampled.length >= MAX_ADRS) break;
      const text = await ev.files.readText(p);
      if (!text) continue;
      const slice = text.slice(0, MAX_CHARS_PER_ADR);
      sampled.push({ path: p, text: slice });
      totalChars += slice.length;
      if (totalChars >= MAX_INPUT_CHARS) break;
    }

    if (sampled.length === 0) {
      return { kind: "na", reason: "ADR files declared but unreadable" };
    }

    const input = sampled.map((s) => `# ${s.path}\n\n${s.text}`).join("\n\n---\n\n");

    const result = await ev.judge.score({
      probeId: "docs.adr-quality",
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
      name: "no-adrs",
      evidence: {
        size_stats: { files: [], totalBytes: 0, totalFiles: 0, source: "git-ls-files" },
      },
      expect: { reading: { kind: "na", reason: "no ADRs found" }, score: null },
    },
    {
      name: "substantive-adrs",
      evidence: {
        size_stats: {
          source: "git-ls-files",
          totalBytes: 200,
          totalFiles: 1,
          files: [{ path: "docs/adr/0001-stack.md", bytes: 200, lines: 20, depth: 2 }],
        },
        files: {
          "docs/adr/0001-stack.md":
            "# Use TypeScript\nStatus: Accepted (2026-01)\nDecision: ts.\nWhy: types catch errors.\n",
        },
        judge: {
          score: 80,
          perCriterion: {
            "decision-stated": 80,
            "rationale-clear": 80,
            "current-and-living": 80,
          },
          rationale: "Clear decision, dated, with rationale.",
          model: "fixture",
        },
      },
      expect: {
        reading: {
          kind: "judge",
          score: 80,
          perCriterion: {
            "decision-stated": 80,
            "rationale-clear": 80,
            "current-and-living": 80,
          },
          rationale: "Clear decision, dated, with rationale.",
          model: "fixture",
        },
        score: 80,
      },
    },
  ],
});
