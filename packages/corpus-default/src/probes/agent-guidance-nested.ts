import type { InventoryItem } from "@esbenwiberg/repofit/sdk";
import { defineProbe } from "@esbenwiberg/repofit/sdk";

const NESTED_MANIFESTS = [
  /(?:^|\/)package\.json$/,
  /(?:^|\/)pyproject\.toml$/,
  /(?:^|\/)Cargo\.toml$/,
  /(?:^|\/)go\.mod$/,
  /(?:^|\/)pom\.xml$/,
  /(?:^|\/)build\.gradle(?:\.kts)?$/,
  /\.csproj$/,
  /(?:^|\/)Gemfile$/,
];

const GUIDANCE_FILES = ["CLAUDE.md", "AGENTS.md", ".cursorrules", ".aider.conf.yml"];

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

function isSubPackageManifest(path: string): boolean {
  if (dirOf(path) === "") return false;
  return NESTED_MANIFESTS.some((re) => re.test(path));
}

function hasSiblingGuidance(dir: string, allPaths: Set<string>): boolean {
  return GUIDANCE_FILES.some((name) => allPaths.has(`${dir}/${name}`));
}

export default defineProbe({
  id: "agent.guidance-nested",
  version: "1.0.0",
  dimensions: [{ id: "context", weight: 1 }],
  tier: "static",
  evidence: ["size_stats"],

  rationale: `
    In a monorepo, a root CLAUDE.md gives the agent shape-of-the-whole
    context, but per-package guidance is what lets it work inside a
    package without re-reading the entire repo. This probe finds
    sub-package manifests (package.json, pyproject.toml, Cargo.toml,
    go.mod, pom.xml, *.csproj, Gemfile) and checks each for a sibling
    CLAUDE.md / AGENTS.md. Returns n/a for single-package repos.
  `,

  remediation:
    "For each sub-package without nested guidance, add a `CLAUDE.md` (or `AGENTS.md`) describing what that package does, how to build/test it, and any package-specific conventions. Even 10–20 lines per package is enough — the goal is letting the agent orient itself without reading the entire repo.",

  async detect(ev) {
    const allPaths = ev.size_stats.files.map((f) => f.path);
    const pathSet = new Set(allPaths);

    const packageDirs = new Set<string>();
    for (const p of allPaths) {
      if (isSubPackageManifest(p)) packageDirs.add(dirOf(p));
    }

    if (packageDirs.size === 0) {
      return { kind: "na", reason: "no sub-package manifests" };
    }

    const items: InventoryItem[] = [];
    for (const dir of packageDirs) {
      if (!hasSiblingGuidance(dir, pathSet)) {
        items.push({
          location: { path: dir },
          severity: "warn",
          message: `no CLAUDE.md / AGENTS.md next to sub-package`,
        });
      }
    }

    return { kind: "inventory", items };
  },

  score: {
    kind: "inventory",
    severityWeights: { info: 1, warn: 1, error: 1 },
    bands: [
      { upTo: 0, score: 100 },
      { upTo: 1, score: 80 },
      { upTo: 3, score: 60 },
      { upTo: 5, score: 30 },
      { score: 0 },
    ],
  },

  fixtures: [
    {
      name: "single-package-repo",
      evidence: {
        size_stats: {
          source: "git-ls-files",
          totalBytes: 50,
          totalFiles: 1,
          files: [{ path: "package.json", bytes: 50, lines: 3, depth: 0 }],
        },
      },
      expect: { reading: { kind: "na", reason: "no sub-package manifests" }, score: null },
    },
    {
      name: "monorepo-all-packages-have-guidance",
      evidence: {
        size_stats: {
          source: "git-ls-files",
          totalBytes: 400,
          totalFiles: 6,
          files: [
            { path: "package.json", bytes: 50, lines: 3, depth: 0 },
            { path: "CLAUDE.md", bytes: 100, lines: 10, depth: 0 },
            { path: "packages/a/package.json", bytes: 50, lines: 3, depth: 2 },
            { path: "packages/a/CLAUDE.md", bytes: 100, lines: 10, depth: 2 },
            { path: "packages/b/package.json", bytes: 50, lines: 3, depth: 2 },
            { path: "packages/b/AGENTS.md", bytes: 100, lines: 10, depth: 2 },
          ],
        },
      },
      expect: { reading: { kind: "inventory", items: [] }, score: 100 },
    },
    {
      name: "monorepo-one-package-missing-guidance",
      evidence: {
        size_stats: {
          source: "git-ls-files",
          totalBytes: 300,
          totalFiles: 5,
          files: [
            { path: "package.json", bytes: 50, lines: 3, depth: 0 },
            { path: "packages/a/package.json", bytes: 50, lines: 3, depth: 2 },
            { path: "packages/a/CLAUDE.md", bytes: 100, lines: 10, depth: 2 },
            { path: "packages/b/package.json", bytes: 50, lines: 3, depth: 2 },
            { path: "packages/c/package.json", bytes: 50, lines: 3, depth: 2 },
          ],
        },
      },
      expect: {
        reading: {
          kind: "inventory",
          items: [
            {
              location: { path: "packages/b" },
              severity: "warn",
              message: "no CLAUDE.md / AGENTS.md next to sub-package",
            },
            {
              location: { path: "packages/c" },
              severity: "warn",
              message: "no CLAUDE.md / AGENTS.md next to sub-package",
            },
          ],
        },
        score: 60,
      },
    },
    {
      name: "mixed-ecosystem-monorepo",
      evidence: {
        size_stats: {
          source: "git-ls-files",
          totalBytes: 300,
          totalFiles: 4,
          files: [
            { path: "services/api/go.mod", bytes: 50, lines: 3, depth: 2 },
            { path: "services/api/CLAUDE.md", bytes: 100, lines: 10, depth: 2 },
            { path: "services/worker/Cargo.toml", bytes: 50, lines: 3, depth: 2 },
            { path: "ui/package.json", bytes: 50, lines: 3, depth: 1 },
          ],
        },
      },
      expect: {
        reading: {
          kind: "inventory",
          items: [
            {
              location: { path: "services/worker" },
              severity: "warn",
              message: "no CLAUDE.md / AGENTS.md next to sub-package",
            },
            {
              location: { path: "ui" },
              severity: "warn",
              message: "no CLAUDE.md / AGENTS.md next to sub-package",
            },
          ],
        },
        score: 60,
      },
    },
  ],
});
