import { posix as path } from "node:path";
import type { CommitRecord, InventoryItem } from "@esbenwiberg/repofit/sdk";
import { defineProbe } from "@esbenwiberg/repofit/sdk";

const SOURCE_FILE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/i;
const TEST_FILE = /(?:\.test\.|\.spec\.|__tests__|^tests?\/|^e2e\/)/i;
const SKIP_DIRS = /(?:^|\/)(?:node_modules|dist|build|coverage|\.next|\.nuxt|out|target|bin|obj)\//;
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const FAN_OUT_WARN = 12;
const FAN_IN_WARN = 20;
/** Fewer commits than this and churn is noise (a shallow CI clone, a new repo). */
const CHURN_MIN_HISTORY = 20;
/** A hub is hot when it changed in more than this share of the window ... */
const CHURN_WARN_RATIO = 0.1;
/** ... and at least this many times, so a 20-commit window needs more than 2 touches. */
const CHURN_MIN_TOUCHES = 5;
const MAX_ITEMS = 30;

const IMPORT_RE =
  /\bimport\s+(?:type\s+)?(?:[^"'`]*?\s+from\s+)?["'`]([^"'`]+)["'`]|\brequire\s*\(\s*["'`]([^"'`]+)["'`]\s*\)|\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g;

/** Three layer entry points each imported by every feature module. */
const HUBS = [
  "src/application/ports/index.ts",
  "src/domain/dates/index.ts",
  "src/domain/hours/index.ts",
];
const IMPORTERS = FAN_IN_WARN + 1;

function layeredRepo() {
  const files: Record<string, string> = {};
  for (const hub of HUBS) files[hub] = "export const x = 1;\n";
  for (let i = 0; i < IMPORTERS; i += 1) {
    files[`src/features/f${i}.ts`] = [
      'import "../application/ports";',
      'import "../domain/dates";',
      'import "../domain/hours";',
      "",
    ].join("\n");
  }
  const paths = Object.keys(files);
  return {
    files,
    size_stats: {
      source: "git-ls-files" as const,
      totalBytes: paths.length * 60,
      totalFiles: paths.length,
      files: paths.map((path) => ({ path, bytes: 60, lines: 3, depth: 2 })),
    },
  };
}

/** `commits` commits, the first `hubTouches` of which touch every hub. */
function history({ hubTouches, commits = 100 }: { hubTouches: number; commits?: number }) {
  return {
    available: true,
    commits: Array.from({ length: commits }, (_, i) => ({
      sha: `c${i}`,
      subject: `chore: ${i}`,
      authorEmail: "a@b",
      files: i < hubTouches ? [...HUBS, "src/features/f0.ts"] : ["README.md"],
    })),
  };
}

type Churn = { window: number; touches: Map<string, number> };

/**
 * Commits in the window that touched each path. Commits without a `files`
 * list (older engines, hand-written fixtures) carry no churn information,
 * so the window counts only commits that have one.
 */
function churnByPath(commits: CommitRecord[]): Churn {
  const touches = new Map<string, number>();
  let window = 0;
  for (const commit of commits) {
    if (!commit.files) continue;
    window += 1;
    for (const file of new Set(commit.files)) {
      touches.set(file, (touches.get(file) ?? 0) + 1);
    }
  }
  return { window, touches };
}

function fanInItem(p: string, fanIn: number, churn: Churn): InventoryItem {
  const base = `high fan-in: imported by ${fanIn} local modules`;
  if (churn.window < CHURN_MIN_HISTORY) {
    return {
      location: { path: p },
      severity: "info",
      message: `${base} (churn unknown: ${churn.window} commits of history)`,
    };
  }
  const touched = churn.touches.get(p) ?? 0;
  const hot = touched >= CHURN_MIN_TOUCHES && touched / churn.window > CHURN_WARN_RATIO;
  return {
    location: { path: p },
    severity: hot ? "warn" : "info",
    message: `${base}, ${hot ? "changed" : "stable: changed"} in ${touched} of the last ${churn.window} commits`,
  };
}

function extractImports(text: string): string[] {
  const out: string[] = [];
  IMPORT_RE.lastIndex = 0;
  let match = IMPORT_RE.exec(text);
  while (match !== null) {
    const spec = match[1] ?? match[2] ?? match[3];
    if (spec?.startsWith(".")) out.push(spec);
    match = IMPORT_RE.exec(text);
  }
  return out;
}

function resolveRelativeImport(
  fromPath: string,
  spec: string,
  sourceSet: Set<string>,
): string | null {
  const base = path.normalize(path.join(path.dirname(fromPath), spec));
  const candidates = [base, ...EXTENSIONS.map((ext) => `${base}${ext}`)];
  for (const ext of EXTENSIONS) candidates.push(path.join(base, `index${ext}`));
  return candidates.find((candidate) => sourceSet.has(candidate)) ?? null;
}

function findCycles(graph: Map<string, Set<string>>): string[][] {
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function visit(node: string) {
    if (cycles.length >= 10) return;
    visiting.add(node);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (visiting.has(next)) {
        const idx = stack.indexOf(next);
        const cycle = [...stack.slice(idx), next];
        const key = canonicalCycleKey(cycle);
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cycle);
        }
      } else if (!visited.has(next)) {
        visit(next);
      }
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) visit(node);
  }
  return cycles;
}

function canonicalCycleKey(cycle: string[]): string {
  const body = cycle.slice(0, -1);
  const rotations = body.map((_, i) => [...body.slice(i), ...body.slice(0, i)].join(" -> "));
  return rotations.sort()[0] ?? cycle.join(" -> ");
}

export default defineProbe({
  id: "arch.coupling-hotspots",
  version: "1.1.0",
  dimensions: [
    { id: "context", weight: 0.5 },
    { id: "cost", weight: 1 },
    { id: "consistency", weight: 0.5 },
  ],
  tier: "historical",
  evidence: ["files", "size_stats", "commit_history"],

  rationale: `
    Agents pay for coupling twice: they need more context before changing a
    hotspot, and each edit has a wider blast radius. This probe builds a
    lightweight graph from relative JS/TS imports and flags import cycles,
    high fan-out files, and high fan-in files.

    Fan-in alone is not a hotspot. A value type or a layer's public barrel
    imported by fifty modules and changed twice a year is the Stable
    Dependencies Principle working; the same fan-in on a module that
    changes every week is the real blast radius. So a high fan-in module is
    only a warning when it also churns (changed in more than 10% of the
    last 100 commits, at least 5 times); a stable hub is listed as info so
    it still gets a name. Without enough history to tell (fewer than 20
    commits, as in a shallow clone), fan-in is reported as info too.
  `,

  remediation:
    "Break import cycles and split files that import too many local modules. For a high fan-in module that keeps changing, freeze its contract: move volatile logic behind it into the modules that own it, add tests at the boundary, and name it in the architecture doc. A stable hub with many importers is fine; it is listed so it stays visible.",

  async detect(ev) {
    const sourcePaths = ev.size_stats.files
      .filter((f) => !f.generated)
      .map((f) => f.path)
      .filter((p) => SOURCE_FILE.test(p) && !TEST_FILE.test(p) && !SKIP_DIRS.test(`/${p}`))
      .sort();

    if (sourcePaths.length === 0) {
      return { kind: "na", reason: "no JS/TS source files detected" };
    }

    const sourceSet = new Set(sourcePaths);
    const graph = new Map<string, Set<string>>();
    for (const p of sourcePaths) graph.set(p, new Set());

    for (const p of sourcePaths) {
      const text = await ev.files.readText(p);
      if (!text) continue;
      for (const spec of extractImports(text)) {
        const resolved = resolveRelativeImport(p, spec, sourceSet);
        if (resolved) graph.get(p)?.add(resolved);
      }
    }

    const items: InventoryItem[] = [];
    const cycles = findCycles(graph);
    for (const cycle of cycles.slice(0, 10)) {
      items.push({
        location: { path: cycle[0] ?? "" },
        severity: "error",
        message: `import cycle: ${cycle.join(" -> ")}`,
      });
    }

    const fanIn = new Map<string, number>();
    for (const p of sourcePaths) fanIn.set(p, 0);
    for (const deps of graph.values()) {
      for (const dep of deps) fanIn.set(dep, (fanIn.get(dep) ?? 0) + 1);
    }

    for (const [p, deps] of graph) {
      if (deps.size > FAN_OUT_WARN) {
        items.push({
          location: { path: p },
          severity: "warn",
          message: `high fan-out: imports ${deps.size} local modules`,
        });
      }
    }
    const churn = churnByPath(ev.commit_history.available ? ev.commit_history.commits : []);
    for (const [p, count] of fanIn) {
      if (count > FAN_IN_WARN) {
        items.push(fanInItem(p, count, churn));
      }
    }

    return { kind: "inventory", items: items.slice(0, MAX_ITEMS) };
  },

  score: {
    kind: "inventory",
    severityWeights: { info: 1, warn: 3, error: 10 },
    bands: [
      { upTo: 0, score: 100 },
      { upTo: 3, score: 80 },
      { upTo: 6, score: 50 },
      { upTo: 9, score: 20 },
      { score: 0 },
    ],
  },

  fixtures: [
    {
      name: "no-js-ts-source",
      evidence: {
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 1,
          files: [{ path: "README.md", bytes: 100, lines: 5, depth: 0 }],
        },
      },
      expect: { reading: { kind: "na", reason: "no JS/TS source files detected" }, score: null },
    },
    {
      name: "simple-acyclic",
      evidence: {
        files: {
          "src/a.ts": 'import { b } from "./b";\nexport const a = b;\n',
          "src/b.ts": "export const b = 1;\n",
        },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 120,
          totalFiles: 2,
          files: [
            { path: "src/a.ts", bytes: 80, lines: 2, depth: 1 },
            { path: "src/b.ts", bytes: 40, lines: 1, depth: 1 },
          ],
        },
      },
      expect: { reading: { kind: "inventory", items: [] }, score: 100 },
    },
    {
      name: "cycle",
      evidence: {
        files: {
          "src/a.ts": 'import { b } from "./b";\nexport const a = b;\n',
          "src/b.ts": 'import { a } from "./a";\nexport const b = a;\n',
        },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 160,
          totalFiles: 2,
          files: [
            { path: "src/a.ts", bytes: 80, lines: 2, depth: 1 },
            { path: "src/b.ts", bytes: 80, lines: 2, depth: 1 },
          ],
        },
      },
      expect: {
        reading: {
          kind: "inventory",
          items: [
            {
              location: { path: "src/a.ts" },
              severity: "error",
              message: "import cycle: src/a.ts -> src/b.ts -> src/a.ts",
            },
          ],
        },
        score: 0,
      },
    },
    {
      name: "three-stable-hubs",
      evidence: { ...layeredRepo(), commit_history: history({ hubTouches: 2 }) },
      expect: {
        reading: {
          kind: "inventory",
          items: HUBS.map((hub) => ({
            location: { path: hub },
            severity: "info",
            message: `high fan-in: imported by ${IMPORTERS} local modules, stable: changed in 2 of the last 100 commits`,
          })),
        },
        score: 80,
      },
    },
    {
      name: "three-churning-hubs",
      evidence: { ...layeredRepo(), commit_history: history({ hubTouches: 15 }) },
      expect: {
        reading: {
          kind: "inventory",
          items: HUBS.map((hub) => ({
            location: { path: hub },
            severity: "warn",
            message: `high fan-in: imported by ${IMPORTERS} local modules, changed in 15 of the last 100 commits`,
          })),
        },
        score: 20,
      },
    },
    {
      name: "hubs-with-shallow-history",
      evidence: { ...layeredRepo(), commit_history: history({ hubTouches: 5, commits: 5 }) },
      expect: {
        reading: {
          kind: "inventory",
          items: HUBS.map((hub) => ({
            location: { path: hub },
            severity: "info",
            message: `high fan-in: imported by ${IMPORTERS} local modules (churn unknown: 5 commits of history)`,
          })),
        },
        score: 80,
      },
    },
  ],
});
