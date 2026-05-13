import { defineProbe } from "@esbenwiberg/repofit/sdk";

const SECRET_TOOL_HINTS = [
  /\bsecretlint\b/i,
  /\bgitleaks\b/i,
  /\btruffle?hog\b/i,
  /\bdetect-secrets\b/i,
  /\bggshield\b/i,
  /\btrivy\s+fs\b/i,
];

const PRECOMMIT_PATHS = [
  ".pre-commit-config.yaml",
  ".pre-commit-config.yml",
  ".husky/pre-commit",
  ".githooks/pre-commit",
];

const SH_PATH = /([A-Za-z0-9_./-]+\.sh)\b/g;

function resolveHelperPaths(hookPath: string, scriptRef: string, allFiles: string[]): string[] {
  const basename = scriptRef.split("/").pop();
  if (!basename?.endsWith(".sh")) return [];
  const hookDir = hookPath.split("/").slice(0, -1).join("/");
  return allFiles.filter((p) => {
    if (p.split("/").pop() !== basename) return false;
    return hookDir.length === 0 || p.startsWith(`${hookDir}/`);
  });
}

export default defineProbe({
  id: "secrets.precommit-scan-configured",
  version: "1.1.0",
  dimensions: [{ id: "safety", weight: 1 }],
  tier: "derived",
  evidence: ["files", "size_stats", "ci_workflows"],

  rationale: `
    A pre-commit or CI step that scans for secrets is the only durable
    defense against accidentally committing a token. Without it, prevention
    relies on every human and every agent remembering to check by hand.
    Hooks that source helper scripts (e.g. .githooks/lib/secret-checks.sh)
    are followed one level deep so the scanner is still recognised.
  `,

  async detect(ev) {
    const allFiles = ev.size_stats.files.map((f) => f.path);
    const visited = new Set<string>();
    for (const path of PRECOMMIT_PATHS) {
      const raw = await ev.files.readText(path);
      if (!raw) continue;
      if (SECRET_TOOL_HINTS.some((p) => p.test(raw))) {
        return { kind: "predicate", value: true };
      }
      for (const m of raw.matchAll(SH_PATH)) {
        const ref = m[1];
        if (!ref) continue;
        for (const candidate of resolveHelperPaths(path, ref, allFiles)) {
          if (visited.has(candidate)) continue;
          visited.add(candidate);
          const childRaw = await ev.files.readText(candidate);
          if (childRaw && SECRET_TOOL_HINTS.some((p) => p.test(childRaw))) {
            return { kind: "predicate", value: true };
          }
        }
      }
    }
    for (const wf of ev.ci_workflows.workflows) {
      if (SECRET_TOOL_HINTS.some((p) => p.test(wf.raw))) {
        return { kind: "predicate", value: true };
      }
    }
    return { kind: "predicate", value: false };
  },

  score: { kind: "predicate", direction: "positive" },

  fixtures: [
    {
      name: "nothing-configured",
      evidence: {
        files: [],
        size_stats: { files: [], totalBytes: 0, totalFiles: 0, source: "git-ls-files" },
        ci_workflows: { present: false, workflows: [] },
      },
      expect: { reading: { kind: "predicate", value: false }, score: 0 },
    },
    {
      name: "secretlint-in-husky",
      evidence: {
        files: { ".husky/pre-commit": "npx secretlint --maskSecrets '**/*'\n" },
        size_stats: { files: [], totalBytes: 0, totalFiles: 0, source: "git-ls-files" },
        ci_workflows: { present: false, workflows: [] },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "gitleaks-in-sourced-helper",
      evidence: {
        files: {
          ".githooks/pre-commit": 'bash "$SCRIPT_DIR/lib/secret-checks.sh"\n',
          ".githooks/lib/secret-checks.sh": "gitleaks protect --staged\n",
        },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 2,
          files: [
            { path: ".githooks/pre-commit", bytes: 50, lines: 5, depth: 1 },
            { path: ".githooks/lib/secret-checks.sh", bytes: 50, lines: 5, depth: 2 },
          ],
        },
        ci_workflows: { present: false, workflows: [] },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "gitleaks-in-ci",
      evidence: {
        files: [],
        size_stats: { files: [], totalBytes: 0, totalFiles: 0, source: "git-ls-files" },
        ci_workflows: {
          present: true,
          workflows: [
            { path: ".github/workflows/security.yml", raw: "uses: zricethezav/gitleaks-action@v2" },
          ],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
  ],
});
