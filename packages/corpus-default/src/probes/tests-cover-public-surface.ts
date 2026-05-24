import { defineProbe } from "@esbenwiberg/repofit/sdk";

const PROBE_VERSION = "2.0.0";
const MAX_SOURCE_FILES = 30;
const MAX_TEST_FILES = 30;
const MAX_INPUT_CHARS = 12_000;

const TEST_FILE =
  /(?:\.test\.|\.spec\.|__tests__|^tests?\/|(?:^|\/)test_[^/]+\.py$|(?:^|\/)[^/]+_test\.go$|(?:^|\/)[^/]+Tests?\.cs$)/i;
const SOURCE_FILE = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|cs|go)$/i;
const SKIP_DIRS =
  /(?:^|\/)(?:node_modules|dist|build|coverage|\.next|\.nuxt|out|\.venv|venv|__pycache__|bin|obj)\//;

const RUBRIC = {
  task: "Judge whether the test suite meaningfully covers this project's public surface — the exported/public functions, classes, types, and packages an agent would likely modify — based on what tests import or reference.",
  criteria: [
    {
      id: "surface-named",
      description:
        "Do the project's public symbols (JS/TS exports, Python top-level public defs/classes, Go exported identifiers, .NET public types/members) appear by name in test imports or references? Tests that only run main entry points without reference to specific public symbols score low.",
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

function extractPublicSurface(path: string, text: string): string[] {
  if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(path)) {
    return [
      ...extract(
        text,
        /^\s*export\s+(?:(?:async\s+)?function|class|const|let|var|interface|type|enum|default)\s+\w+/,
      ),
      ...extract(text, /^\s*export\s*\{[^}]+\}/),
    ];
  }
  if (/\.py$/i.test(path)) {
    return [
      ...extract(text, /^(?:async\s+)?def\s+[A-Za-z]\w*\s*\(/),
      ...extract(text, /^class\s+[A-Za-z]\w*\b/),
    ];
  }
  if (/\.go$/i.test(path)) {
    return [
      ...extract(text, /^func\s+(?:\([^)]*\)\s*)?[A-Z]\w*\s*\(/),
      ...extract(text, /^type\s+[A-Z]\w*\b/),
      ...extract(text, /^var\s+[A-Z]\w*\b/),
      ...extract(text, /^const\s+[A-Z]\w*\b/),
    ];
  }
  if (/\.cs$/i.test(path)) {
    return [
      ...extract(
        text,
        /^\s*public\s+(?:sealed\s+|abstract\s+|static\s+|partial\s+)*(?:class|record|interface|enum|struct)\s+\w+/,
      ),
      ...extract(
        text,
        /^\s*public\s+(?:static\s+|virtual\s+|override\s+|async\s+)*[\w<>[\],.?]+\s+\w+\s*\(/,
      ),
    ];
  }
  return [];
}

function extractTestReferences(path: string, text: string): string[] {
  if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(path)) {
    return extract(text, /^\s*import\s.+?from\s+["'][^"']+["']/);
  }
  if (/\.py$/i.test(path)) {
    return [
      ...extract(text, /^\s*from\s+[A-Za-z_][\w.]*\s+import\s+.+/),
      ...extract(text, /^\s*import\s+[A-Za-z_][\w.]*(?:\s+as\s+\w+)?/),
    ];
  }
  if (/\.go$/i.test(path)) {
    return [
      ...extract(text, /^\s*import\s+(?:\w+\s+)?".+"/),
      ...extract(text, /^\s*(?:\w+\s+)?".+"$/),
    ];
  }
  if (/\.cs$/i.test(path)) {
    return extract(text, /^\s*using\s+[\w.]+;/);
  }
  return [];
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

  remediation:
    "Test by named export, not just end-to-end. For each major public function/class, add a test file that imports it by name and exercises its contract. Co-locate tests (`foo.ts` + `foo.test.ts`) or mirror the source layout in a parallel `test/` tree — both let an agent find the test for a symbol it just touched.",

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
      const lines = extractPublicSurface(p, text);
      for (const l of lines) exportLines.push(`${p}: ${l}`);
    }

    const importLines: string[] = [];
    const testsToScan = testPaths.slice(0, MAX_TEST_FILES);
    for (const p of testsToScan) {
      const text = await ev.files.readText(p);
      if (!text) continue;
      const lines = extractTestReferences(p, text);
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
      "# Public surface from source files",
      exportLines.join("\n"),
      "",
      "# Imports/references inside test files",
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
    {
      name: "python-public-surface",
      evidence: {
        size_stats: {
          source: "git-ls-files",
          totalBytes: 200,
          totalFiles: 2,
          files: [
            { path: "src/demo/scoring.py", bytes: 100, lines: 10, depth: 2 },
            { path: "tests/test_scoring.py", bytes: 100, lines: 10, depth: 1 },
          ],
        },
        files: {
          "src/demo/scoring.py": "def score(value: int) -> int:\n    return value * 2\n",
          "tests/test_scoring.py":
            "from demo.scoring import score\n\ndef test_score():\n    assert score(2) == 4\n",
        },
        judge: {
          score: 80,
          perCriterion: { "surface-named": 80, breadth: 80, discoverability: 80 },
          rationale: "Python public function imported by name from mirrored tests.",
          model: "fixture",
        },
      },
      expect: {
        reading: {
          kind: "judge",
          score: 80,
          perCriterion: { "surface-named": 80, breadth: 80, discoverability: 80 },
          rationale: "Python public function imported by name from mirrored tests.",
          model: "fixture",
        },
        score: 80,
      },
    },
  ],
});
