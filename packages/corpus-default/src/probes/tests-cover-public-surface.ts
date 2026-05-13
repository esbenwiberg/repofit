import { defineProbe } from "@esbenwiberg/repofit/sdk";

const PROBE_VERSION = "1.0.0";
const MAX_SOURCE_FILES = 30;
const MAX_TEST_FILES = 30;
const MAX_INPUT_CHARS = 12_000;

const TEST_FILE = /(?:\.test\.|\.spec\.|__tests__|^tests?\/)/i;
const EXPORT_LINE =
  /^\s*export\s+(?:(?:async\s+)?function|class|const|let|var|interface|type|enum|default)\s+\w+/m;
const EXPORT_NAMED_BRACE = /^\s*export\s*\{[^}]+\}/m;
const IMPORT_LINE = /^\s*import\s.+?from\s+["'][^"']+["']/m;
const SOURCE_FILE = /\.(?:ts|tsx|js|mjs|cjs)$/;
const SKIP_DIRS = /(?:^|\/)(?:node_modules|dist|build|coverage|\.next|\.nuxt|out)\//;

const RUBRIC = {
  task: "Judge whether the test suite meaningfully covers this project's public surface — the named exports an agent would likely modify — based on what gets imported in tests.",
  criteria: [
    {
      id: "surface-named",
      description:
        "Do the project's named exports (functions, classes, types from index/entry files) appear by name in test imports? Tests that only import and run main entry points without reference to specific exports score low; tests that import named symbols and exercise them score high.",
    },
    {
      id: "breadth",
      description:
        "Is there breadth — most major subsystems have at least one test file mentioning them — or is testing concentrated in one or two areas with the rest untested? Big gaps in coverage of the public surface are worth fewer points.",
    },
    {
      id: "discoverability",
      description:
        "Are tests located so an agent can find them — colocated next to sources (foo.ts + foo.test.ts), in a parallel test/ tree that mirrors src/, or in __tests__ folders? Tests scattered with no convention or all stuffed into one mega-file score lower.",
    },
  ],
} as const;

function extract(text: string, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const line of text.split(/\n/)) {
    if (pattern.test(line)) out.push(line.trim());
  }
  return out;
}

export default defineProbe({
  id: "tests.cover-public-surface",
  version: PROBE_VERSION,
  dimensions: [{ id: "feedback", weight: 1 }],
  tier: "reasoned",
  evidence: ["files", "size_stats", "judge"],

  rationale: `
    Coverage % tells you which lines run, not whether the public surface is
    meaningfully tested. A repo can have 90% line coverage with one
    end-to-end test that touches everything once. This probe gives an LLM
    the exported names from your source files and the imports inside your
    test files, then asks whether the surface is named and exercised.
    Cached, so a clean run is free.
  `,

  async detect(ev) {
    const allPaths = ev.size_stats.files
      .map((f) => f.path)
      .filter((p) => SOURCE_FILE.test(p) && !SKIP_DIRS.test(`/${p}`));

    const testPaths: string[] = [];
    const sourcePaths: string[] = [];
    for (const p of allPaths) {
      if (TEST_FILE.test(p)) testPaths.push(p);
      else sourcePaths.push(p);
    }

    if (testPaths.length === 0) {
      return { kind: "na", reason: "no test files detected" };
    }
    if (sourcePaths.length === 0) {
      return { kind: "na", reason: "no source files detected" };
    }

    const exportLines: string[] = [];
    const sourcesToScan = sourcePaths.slice(0, MAX_SOURCE_FILES);
    for (const p of sourcesToScan) {
      const text = await ev.files.readText(p);
      if (!text) continue;
      const lines = [...extract(text, EXPORT_LINE), ...extract(text, EXPORT_NAMED_BRACE)];
      for (const l of lines) exportLines.push(`${p}: ${l}`);
    }

    const importLines: string[] = [];
    const testsToScan = testPaths.slice(0, MAX_TEST_FILES);
    for (const p of testsToScan) {
      const text = await ev.files.readText(p);
      if (!text) continue;
      const lines = extract(text, IMPORT_LINE);
      for (const l of lines) importLines.push(`${p}: ${l}`);
    }

    if (exportLines.length === 0 && importLines.length === 0) {
      return { kind: "na", reason: "no exports or test imports could be extracted" };
    }

    const inputParts: string[] = [];
    inputParts.push(
      `# Project shape`,
      `${sourcePaths.length} source files, ${testPaths.length} test files`,
      `(showing exports from up to ${MAX_SOURCE_FILES} sources, imports from up to ${MAX_TEST_FILES} tests)`,
      "",
      "# Test file paths",
      testsToScan.join("\n"),
      "",
      "# Exports from source files",
      exportLines.join("\n"),
      "",
      "# Imports inside test files",
      importLines.join("\n"),
    );
    const input = inputParts.join("\n").slice(0, MAX_INPUT_CHARS);

    const result = await ev.judge.score({
      probeId: "tests.cover-public-surface",
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
          files: [{ path: "src/index.ts", bytes: 100, lines: 10, depth: 1 }],
        },
      },
      expect: { reading: { kind: "na", reason: "no test files detected" }, score: null },
    },
    {
      name: "no-sources",
      evidence: {
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 1,
          files: [{ path: "test/foo.test.ts", bytes: 100, lines: 10, depth: 1 }],
        },
      },
      expect: { reading: { kind: "na", reason: "no source files detected" }, score: null },
    },
    {
      name: "strong-coverage",
      evidence: {
        size_stats: {
          source: "git-ls-files",
          totalBytes: 200,
          totalFiles: 2,
          files: [
            { path: "src/score.ts", bytes: 100, lines: 10, depth: 1 },
            { path: "src/score.test.ts", bytes: 100, lines: 10, depth: 1 },
          ],
        },
        files: {
          "src/score.ts": "export function score(x: number) { return x * 2; }\n",
          "src/score.test.ts": 'import { score } from "./score";\ntest("score", () => {});\n',
        },
        judge: {
          score: 80,
          perCriterion: { "surface-named": 80, breadth: 80, discoverability: 80 },
          rationale: "Named exports referenced in colocated tests.",
          model: "fixture",
        },
      },
      expect: {
        reading: {
          kind: "judge",
          score: 80,
          perCriterion: { "surface-named": 80, breadth: 80, discoverability: 80 },
          rationale: "Named exports referenced in colocated tests.",
          model: "fixture",
        },
        score: 80,
      },
    },
  ],
});
