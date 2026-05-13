import { defineProbe } from "@esbenwiberg/repofit/sdk";

const HOOK_PATHS = [
  ".husky/pre-commit",
  ".husky/pre-push",
  ".githooks/pre-commit",
  ".githooks/pre-push",
  ".pre-commit-config.yaml",
  ".pre-commit-config.yml",
];

const SH_PATH = /([A-Za-z0-9_./-]+\.sh)\b/g;

const GATES = [
  {
    id: "lint",
    patterns: [
      /\blint\b/i,
      /\bbiome\s+(?:check|lint)\b/i,
      /\beslint\b/i,
      /\bruff\s+check\b/i,
      /\bflake8\b/i,
      /\bpylint\b/i,
      /\bgolangci-lint\b/i,
      /\bgo\s+vet\b/i,
      /\bcargo\s+clippy\b/i,
      /\brubocop\b/i,
      /\bstandardrb\b/i,
    ],
  },
  {
    id: "format",
    patterns: [
      /\bformat\b/i,
      /\bprettier\b/i,
      /\bbiome\s+format\b/i,
      /\bruff\s+format\b/i,
      /\bblack\b/i,
      /\bgofmt\b/i,
      /\bcargo\s+fmt\b/i,
      /\bdotnet\s+format\b/i,
    ],
  },
  {
    id: "test",
    patterns: [
      /\btest\b/i,
      /\bvitest\b/i,
      /\bjest\b/i,
      /\bpytest\b/i,
      /\bgo\s+test\b/i,
      /\bcargo\s+test\b/i,
      /\bmvn\s+(?:test|verify)\b/i,
      /\bgradle\s+test\b/i,
      /\bdotnet\s+test\b/i,
      /\brspec\b/i,
      /\bminitest\b/i,
    ],
  },
  {
    id: "typecheck",
    patterns: [/\btypecheck\b/i, /\btsc\b/i, /\bmypy\b/i, /\bpyright\b/i],
  },
  {
    id: "build",
    patterns: [
      /\bbuild\b/i,
      /\bgo\s+build\b/i,
      /\bcargo\s+build\b/i,
      /\bmvn\s+(?:package|install)\b/i,
      /\bgradle\s+build\b/i,
      /\bdotnet\s+build\b/i,
    ],
  },
];

function basename(p: string): string {
  return p.split("/").pop() ?? p;
}

function resolveSiblings(hookPath: string, ref: string, allFiles: string[]): string[] {
  const ext = basename(ref);
  if (!ext.endsWith(".sh")) return [];
  const hookDir = hookPath.split("/").slice(0, -1).join("/");
  return allFiles.filter((p) => {
    if (basename(p) !== ext) return false;
    return hookDir.length === 0 || p.startsWith(`${hookDir}/`);
  });
}

export default defineProbe({
  id: "hooks.gates-lint-test-build",
  version: "1.1.0",
  dimensions: [{ id: "feedback", weight: 1 }],
  tier: "derived",
  evidence: ["files", "size_stats"],

  rationale: `
    A pre-commit hook that only formats but doesn't lint, test, or
    typecheck doesn't prevent broken code from landing — it just prevents
    badly-formatted broken code. This probe inspects the hook (and any
    sibling scripts it sources) and counts how many of the canonical
    gates — lint, format, typecheck, test, build — are actually invoked.
  `,

  remediation:
    "Extend your pre-commit hook to run all five gates: lint, format check, typecheck, test, build. The shorter the loop the agent feels, the faster mistakes are caught — running them locally before commit beats waiting for CI.",

  async detect(ev) {
    const allFiles = ev.size_stats.files.map((f) => f.path);
    let combinedHookText = "";
    const visited = new Set<string>();
    let foundAnyHook = false;

    for (const path of HOOK_PATHS) {
      const raw = await ev.files.readText(path);
      if (!raw) continue;
      foundAnyHook = true;
      combinedHookText += `\n${raw}`;
      for (const m of raw.matchAll(SH_PATH)) {
        const ref = m[1];
        if (!ref) continue;
        for (const sibling of resolveSiblings(path, ref, allFiles)) {
          if (visited.has(sibling)) continue;
          visited.add(sibling);
          const text = await ev.files.readText(sibling);
          if (text) combinedHookText += `\n${text}`;
        }
      }
    }

    if (!foundAnyHook) {
      return { kind: "na", reason: "no git hook found" };
    }

    const gatesHit = GATES.filter((g) => g.patterns.some((p) => p.test(combinedHookText)));
    return { kind: "count", value: gatesHit.length };
  },

  score: {
    kind: "count",
    direction: "positive",
    bands: [
      { upTo: 0, score: 0 },
      { upTo: 1, score: 30 },
      { upTo: 2, score: 60 },
      { upTo: 3, score: 80 },
      { score: 100 },
    ],
  },

  fixtures: [
    {
      name: "no-hook",
      evidence: {
        files: [],
        size_stats: { files: [], totalBytes: 0, totalFiles: 0, source: "git-ls-files" },
      },
      expect: { reading: { kind: "na", reason: "no git hook found" }, score: null },
    },
    {
      name: "only-secrets",
      evidence: {
        files: { ".githooks/pre-commit": "gitleaks protect --staged\n" },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 50,
          totalFiles: 1,
          files: [{ path: ".githooks/pre-commit", bytes: 50, lines: 5, depth: 1 }],
        },
      },
      expect: { reading: { kind: "count", value: 0 }, score: 0 },
    },
    {
      name: "lint-test-typecheck",
      evidence: {
        files: {
          ".husky/pre-commit": "npm run lint && npm run typecheck && npm test\n",
        },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 50,
          totalFiles: 1,
          files: [{ path: ".husky/pre-commit", bytes: 50, lines: 5, depth: 1 }],
        },
      },
      expect: { reading: { kind: "count", value: 3 }, score: 80 },
    },
    {
      name: "all-gates-via-go-toolchain",
      evidence: {
        files: {
          ".githooks/pre-commit":
            "golangci-lint run && gofmt -l . && go test ./... && go build ./...\n",
        },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 80,
          totalFiles: 1,
          files: [{ path: ".githooks/pre-commit", bytes: 80, lines: 3, depth: 1 }],
        },
      },
      expect: { reading: { kind: "count", value: 4 }, score: 100 },
    },
    {
      name: "all-gates-via-cargo",
      evidence: {
        files: {
          ".githooks/pre-commit":
            "cargo clippy && cargo fmt --check && cargo test && cargo build\n",
        },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 80,
          totalFiles: 1,
          files: [{ path: ".githooks/pre-commit", bytes: 80, lines: 3, depth: 1 }],
        },
      },
      expect: { reading: { kind: "count", value: 4 }, score: 100 },
    },
    {
      name: "all-gates-via-sourced-helper",
      evidence: {
        files: {
          ".githooks/pre-commit": 'bash "$SCRIPT_DIR/lib/checks.sh"\n',
          ".githooks/lib/checks.sh":
            "npm run lint && npm run format:check && npm run typecheck && npm test && npm run build\n",
        },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 200,
          totalFiles: 2,
          files: [
            { path: ".githooks/pre-commit", bytes: 50, lines: 5, depth: 1 },
            { path: ".githooks/lib/checks.sh", bytes: 150, lines: 10, depth: 2 },
          ],
        },
      },
      expect: { reading: { kind: "count", value: 5 }, score: 100 },
    },
  ],
});
