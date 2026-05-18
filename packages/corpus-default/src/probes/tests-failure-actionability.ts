import { defineProbe } from "@esbenwiberg/repofit/sdk";

const PROBE_VERSION = "1.0.0";
const MAX_TEST_FILES = 6;
const MAX_CHARS_PER_TEST = 2_500;
const MAX_INPUT_CHARS = 18_000;

const TEST_FILE = /(?:\.test\.|\.spec\.|__tests__|^tests?\/|^e2e\/)/i;
const SOURCE_FILE = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|cs|go|rs|java|kt)$/i;
const SKIP_DIRS = /(?:^|\/)(?:node_modules|dist|build|coverage|\.next|\.nuxt|out|target|bin|obj)\//;

const RUBRIC = {
  task: "Judge whether test failures in this repository would be actionable for a coding agent trying to fix a regression.",
  criteria: [
    {
      id: "scenario-names",
      description:
        "Do test names describe the condition and expected behavior clearly enough to identify the broken contract? Generic names like 'works' or 'handles input' score low.",
    },
    {
      id: "diagnostic-assertions",
      description:
        "Do assertions expose useful expected/actual values, error messages, snapshots with narrow scope, or custom messages? Bare booleans and opaque helper failures score low.",
    },
    {
      id: "localized-failures",
      description:
        "Would a failing test point to a small behavior or subsystem, rather than a giant end-to-end path with many possible causes?",
    },
    {
      id: "reproducible-setup",
      description:
        "Is each test's setup explicit enough that an agent can reproduce and reason about the failure without hidden global state or undocumented fixtures?",
    },
  ],
} as const;

export default defineProbe({
  id: "tests.failure-actionability",
  version: PROBE_VERSION,
  dimensions: [{ id: "feedback", weight: 1 }],
  tier: "reasoned",
  evidence: ["files", "size_stats", "judge"],

  rationale: `
    Tests are only useful feedback when failures explain the broken fact.
    Agents struggle with generic test names, opaque helpers, bare boolean
    assertions, and giant flows where many things could be wrong. This probe
    samples tests and judges whether failures would be diagnostic.
  `,

  remediation:
    "Name tests after the scenario and expected behavior, assert concrete expected/actual values, keep failures localized, and make setup explicit. Prefer `throws /message/`, table cases with named cases, and narrow snapshots over giant opaque failures.",

  async detect(ev) {
    const testPaths = ev.size_stats.files
      .map((f) => f.path)
      .filter((p) => SOURCE_FILE.test(p) && TEST_FILE.test(p) && !SKIP_DIRS.test(`/${p}`))
      .sort();

    if (testPaths.length === 0) {
      return { kind: "na", reason: "no test files detected" };
    }

    const sampled: { path: string; text: string }[] = [];
    let totalChars = 0;
    for (const p of testPaths) {
      if (sampled.length >= MAX_TEST_FILES) break;
      const text = await ev.files.readText(p);
      if (!text) continue;
      const slice = text.slice(0, MAX_CHARS_PER_TEST);
      sampled.push({ path: p, text: slice });
      totalChars += slice.length;
      if (totalChars >= MAX_INPUT_CHARS) break;
    }

    if (sampled.length === 0) {
      return { kind: "na", reason: "test files declared but unreadable" };
    }

    const input = sampled.map((s) => `# ${s.path}\n\n${s.text}`).join("\n\n---\n\n");
    const result = await ev.judge.score({
      probeId: "tests.failure-actionability",
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
      name: "no-tests",
      evidence: {
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 1,
          files: [{ path: "src/index.ts", bytes: 100, lines: 8, depth: 1 }],
        },
      },
      expect: { reading: { kind: "na", reason: "no test files detected" }, score: null },
    },
    {
      name: "actionable-failures",
      evidence: {
        files: {
          "src/cache.test.ts":
            'test("expired cache entry returns a miss with stale reason", () => {\n  const cache = cacheWith({ key: "a", expiresAt: 0 });\n  expect(cache.get("a")).toEqual({ hit: false, reason: "expired" });\n});\n',
        },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 220,
          totalFiles: 1,
          files: [{ path: "src/cache.test.ts", bytes: 220, lines: 5, depth: 1 }],
        },
        judge: {
          score: 80,
          perCriterion: {
            "scenario-names": 80,
            "diagnostic-assertions": 80,
            "localized-failures": 80,
            "reproducible-setup": 80,
          },
          rationale: "The test name, setup, and expected value identify the broken contract.",
          model: "fixture",
        },
      },
      expect: {
        reading: {
          kind: "judge",
          score: 80,
          perCriterion: {
            "scenario-names": 80,
            "diagnostic-assertions": 80,
            "localized-failures": 80,
            "reproducible-setup": 80,
          },
          rationale: "The test name, setup, and expected value identify the broken contract.",
          model: "fixture",
        },
        score: 80,
      },
    },
  ],
});
