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

/**
 * A `fetch(...)` or `axios.<method>(...)` call whose first argument is a
 * string literal with an absolute http(s) URL. `receiver` captures the `.`
 * of a member call (`page.fetch(`), which the local-binding rule leaves alone.
 */
const NETWORK_CALL =
  /(?<receiver>\.)?\b(?:fetch|axios\.\w+)\s*\(\s*["'`]https?:\/\/(?<host>[^/"'`\s:?#]+)/g;

/**
 * Hosts that never reach a network: `localhost` and the `.localhost`, `.test`,
 * `.example` and `.invalid` TLDs are reserved by RFC 2606/6761, and the
 * loopback addresses stay on the machine. A test fetching one of these is
 * talking to a stub or fixture server, not the internet.
 */
const RESERVED_HOST =
  /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0)$|\.(?:localhost|test|example|invalid)$/i;

/**
 * A file that binds its own `fetch` (`const fetch = ...`, `const { fetch } =
 * setup()`, a `fetch` parameter) calls that binding, not the global. Imports
 * (`import fetch from "node-fetch"`) are real network clients and stay flagged.
 */
const LOCAL_FETCH_DECLARATION = [
  /\b(?:const|let|var)\s+fetch\b/,
  /\b(?:const|let|var)\s+\{[^}]*\bfetch\b[^}]*\}/,
  /\bfunction\b[^(]*\([^)]*\bfetch\b[^)]*\)/,
];
const ARROW_PARAMS = /\(([^()]*)\)\s*(?::\s*[^=(){}]*)?=>/g;
const FETCH_PARAM = /(?:^|[\s,{])fetch\b/;

function bindsFetchLocally(text: string): boolean {
  if (LOCAL_FETCH_DECLARATION.some((pattern) => pattern.test(text))) return true;
  for (const match of text.matchAll(ARROW_PARAMS)) {
    if (FETCH_PARAM.test(match[1] ?? "")) return true;
  }
  return false;
}

function callsExternalNetwork(line: string, localFetch: boolean): boolean {
  for (const match of line.matchAll(NETWORK_CALL)) {
    const host = match.groups?.host ?? "";
    if (RESERVED_HOST.test(host)) continue;
    const bareFetch = match.groups?.receiver === undefined && match[0].includes("fetch");
    if (bareFetch && localFetch) continue;
    return true;
  }
  return false;
}

const FLAKE_PATTERNS: {
  matches: (line: string, localFetch: boolean) => boolean;
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
    matches: callsExternalNetwork,
    severity: "warn",
    message: "calls an external network endpoint from a test",
  },
];

export default defineProbe({
  id: "tests.deterministic",
  version: "1.0.1",
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
    reads should be injected, frozen, or otherwise made explicit. A fetch of
    a reserved host (localhost, loopback, the .test/.example/.invalid TLDs)
    or through a fetch the file binds itself is a stub, not a network call.
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
      const localFetch = bindsFetchLocally(text);
      const lines = text.split(/\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? "";
        for (const { matches, severity, message } of FLAKE_PATTERNS) {
          if (matches(line, localFetch)) {
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
    {
      name: "live-network-call",
      evidence: {
        files: {
          "src/api.test.ts":
            'import fetch from "node-fetch";\ntest("reads the live api", async () => {\n  const res = await fetch("https://api.example-corp.com/v1/users");\n  const other = await axios.get("https://api.example-corp.com/v1/teams");\n  expect(res.ok).toBe(true);\n});\n',
        },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 200,
          totalFiles: 1,
          files: [{ path: "src/api.test.ts", bytes: 200, lines: 6, depth: 1 }],
        },
      },
      expect: {
        reading: {
          kind: "inventory",
          items: [
            {
              location: { path: "src/api.test.ts", range: { startLine: 3 } },
              severity: "warn",
              message: "calls an external network endpoint from a test",
            },
            {
              location: { path: "src/api.test.ts", range: { startLine: 4 } },
              severity: "warn",
              message: "calls an external network endpoint from a test",
            },
          ],
        },
        score: 50,
      },
    },
    {
      name: "reserved-hosts-and-local-fetch",
      evidence: {
        files: {
          "dev/dataverse/handlers.test.ts": [
            'import { describe, expect, test, vi } from "vitest";',
            "function setup() {",
            "  const network = createNetwork();",
            "  return { tenant: network.tenant, fetch: network.fetch };",
            "}",
            'test("answers WhoAmI", async () => {',
            "  const { tenant, fetch } = setup();",
            '  expect((await (await fetch("https://org.invalid/api/data/v9.2/WhoAmI")).json()).UserId).toBeTruthy();',
            '  await expect(page.fetch("https://elsewhere.invalid/data")).rejects.toThrow();',
            '  await fetch("http://localhost:3000/health");',
            '  await fetch("http://127.0.0.1:8080/health");',
            '  await axios.get("https://fixture.test/api");',
            "});",
            "",
          ].join("\n"),
          "src/injected.test.ts":
            'async function run(fetch: typeof globalThis.fetch) {\n  return fetch("https://api.example-corp.com/v1/users");\n}\nconst viaArrow = (fetch: typeof globalThis.fetch) => fetch("https://api.example-corp.com/v1/teams");\ntest("uses the injected fetch", async () => {\n  expect(await run(stubFetch)).toBeDefined();\n  expect(await viaArrow(stubFetch)).toBeDefined();\n});\n',
          "src/client.test.ts":
            'test("reads through a client", async () => {\n  await client.fetch("https://api.example-corp.com/v1/users");\n});\n',
        },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 1100,
          totalFiles: 3,
          files: [
            { path: "dev/dataverse/handlers.test.ts", bytes: 600, lines: 13, depth: 2 },
            { path: "src/injected.test.ts", bytes: 300, lines: 8, depth: 1 },
            { path: "src/client.test.ts", bytes: 200, lines: 3, depth: 1 },
          ],
        },
      },
      expect: {
        reading: {
          kind: "inventory",
          items: [
            {
              location: { path: "src/client.test.ts", range: { startLine: 2 } },
              severity: "warn",
              message: "calls an external network endpoint from a test",
            },
          ],
        },
        score: 80,
      },
    },
  ],
});
