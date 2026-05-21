import type { InventoryItem, Severity } from "@esbenwiberg/repofit/sdk";
import { defineProbe } from "@esbenwiberg/repofit/sdk";

const TEST_FILE = /(?:\.test\.|\.spec\.|__tests__|^tests?\/|^e2e\/)/i;
const SOURCE_FILE = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|cs|go|rs|java|kt)$/i;
const SKIP_DIRS = /(?:^|\/)(?:node_modules|dist|build|coverage|\.next|\.nuxt|out|target|bin|obj)\//;

const WALL_CLOCK_TIME = [
  /\bDate\.now\s*\(/,
  /\bnew\s+Date\s*\(\s*\)/,
  /\btime\.time\s*\(/,
  /\bInstant\.now\s*\(/,
];

const FLAKE_PATTERNS: {
  matches: (line: string) => boolean;
  severity: Severity;
  message: string;
}[] = [
  {
    matches: (line) => /\b(?:test|it|describe)\.only\s*\(/.test(line),
    severity: "error",
    message: "commits a focused-only test",
  },
  {
    matches: (line) => /\b(?:test|it|describe)\.skip\s*\(/.test(line),
    severity: "warn",
    message: "skips a test without an executable signal",
  },
  {
    matches: (line) =>
      /\bMath\.random\s*\(|\brandomUUID\s*\(|\brandint\s*\(|\brandom\.\w+\s*\(/.test(line),
    severity: "warn",
    message: "uses randomness without an obvious seed",
  },
  {
    matches: (line) => WALL_CLOCK_TIME.some((pattern) => pattern.test(line)),
    severity: "warn",
    message: "depends on wall-clock time",
  },
  {
    matches: (line) =>
      /\bsetTimeout\s*\([^,]+,\s*(?:[1-9]\d{2,}|[1-9]\d{3,})|\bwaitForTimeout\s*\(/.test(line),
    severity: "warn",
    message: "uses fixed sleeps instead of waiting on a condition",
  },
  {
    matches: (line) =>
      /\bfetch\s*\(\s*["'`]https?:\/\/|\baxios\.\w+\s*\(\s*["'`]https?:\/\//.test(line),
    severity: "warn",
    message: "calls an external network endpoint from a test",
  },
];

export default defineProbe({
  id: "tests.deterministic",
  version: "1.0.0",
  dimensions: [
    { id: "feedback", weight: 1 },
    { id: "latency", weight: 0.3 },
  ],
  tier: "static",
  evidence: ["files", "size_stats"],

  rationale: `
    Flaky tests poison the agent feedback loop: a red result no longer means
    the last change broke behavior. This static probe avoids running large
    suites and instead flags common flake smells in test files: focused tests,
    skips, unseeded randomness, wall-clock time, fixed sleeps, and live
    external network calls. Fixed date literals are allowed; ambient clock
    reads should be injected, frozen, or otherwise made explicit.
  `,

  remediation:
    "Remove focused tests before committing, turn skips into tracked TODOs, seed randomness, inject or freeze clocks for ambient time, replace fixed sleeps with condition waits, and mock or record external network calls. Deterministic failures are the currency agents can spend.",

  async detect(ev) {
    const testPaths = ev.size_stats.files
      .map((f) => f.path)
      .filter((p) => SOURCE_FILE.test(p) && TEST_FILE.test(p) && !SKIP_DIRS.test(`/${p}`))
      .sort();

    if (testPaths.length === 0) {
      return { kind: "na", reason: "no test files detected" };
    }

    const items: InventoryItem[] = [];
    for (const path of testPaths) {
      const text = await ev.files.readText(path);
      if (!text) continue;
      const lines = text.split(/\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? "";
        for (const { matches, severity, message } of FLAKE_PATTERNS) {
          if (matches(line)) {
            items.push({
              location: { path, range: { startLine: i + 1 } },
              severity,
              message,
            });
          }
        }
      }
    }

    return { kind: "inventory", items };
  },

  score: {
    kind: "inventory",
    severityWeights: { info: 1, warn: 2, error: 10 },
    bands: [{ upTo: 0, score: 100 }, { upTo: 2, score: 80 }, { upTo: 6, score: 50 }, { score: 0 }],
  },

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
      name: "deterministic-tests",
      evidence: {
        files: {
          "src/math.test.ts": 'test("adds numbers", () => {\n  expect(add(1, 2)).toBe(3);\n});\n',
        },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 1,
          files: [{ path: "src/math.test.ts", bytes: 100, lines: 3, depth: 1 }],
        },
      },
      expect: { reading: { kind: "inventory", items: [] }, score: 100 },
    },
    {
      name: "flake-smells",
      evidence: {
        files: {
          "e2e/login.spec.ts":
            'test.only("login", async ({ page }) => {\n  await page.waitForTimeout(1000);\n  expect(Date.now()).toBeGreaterThan(0);\n});\n',
        },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 180,
          totalFiles: 1,
          files: [{ path: "e2e/login.spec.ts", bytes: 180, lines: 4, depth: 1 }],
        },
      },
      expect: {
        reading: {
          kind: "inventory",
          items: [
            {
              location: { path: "e2e/login.spec.ts", range: { startLine: 1 } },
              severity: "error",
              message: "commits a focused-only test",
            },
            {
              location: { path: "e2e/login.spec.ts", range: { startLine: 2 } },
              severity: "warn",
              message: "uses fixed sleeps instead of waiting on a condition",
            },
            {
              location: { path: "e2e/login.spec.ts", range: { startLine: 3 } },
              severity: "warn",
              message: "depends on wall-clock time",
            },
          ],
        },
        score: 0,
      },
    },
    {
      name: "fixed-date-literals",
      evidence: {
        files: {
          "src/date-range.test.ts":
            'test("formats fixed fiscal dates", () => {\n  expect(formatRange(new Date("2026-05-21T00:00:00.000Z"), new Date(2026, 4, 22))).toBe("May 21-22, 2026");\n});\n',
        },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 190,
          totalFiles: 1,
          files: [{ path: "src/date-range.test.ts", bytes: 190, lines: 3, depth: 1 }],
        },
      },
      expect: { reading: { kind: "inventory", items: [] }, score: 100 },
    },
    {
      name: "ambient-date-constructor",
      evidence: {
        files: {
          "src/cache.test.ts":
            'test("marks entries as fresh", () => {\n  expect(isFresh(new Date(), ttl)).toBe(true);\n});\n',
        },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 1,
          files: [{ path: "src/cache.test.ts", bytes: 100, lines: 3, depth: 1 }],
        },
      },
      expect: {
        reading: {
          kind: "inventory",
          items: [
            {
              location: { path: "src/cache.test.ts", range: { startLine: 2 } },
              severity: "warn",
              message: "depends on wall-clock time",
            },
          ],
        },
        score: 80,
      },
    },
  ],
});
