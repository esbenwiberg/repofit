import type { InventoryItem } from "@esbenwiberg/repofit/sdk";
import { defineProbe } from "@esbenwiberg/repofit/sdk";
import { agentFixture } from "./_shared/agent-evidence-fixture.js";
import {
  extractReferences,
  isTemplate,
  resolvePathReference,
  targetPath,
} from "./_shared/agent-references.js";
import { basename, canonicalRoot, dirname, isPointer, trackedTree } from "./_shared/agent-tree.js";
import { compileGlob } from "./_shared/glob.js";

/** Scoped guides proper; per-topic rule files have their own path triggers. */
const NESTED_BASENAMES = new Set(["AGENTS.md", "CLAUDE.md", "GEMINI.md"]);
/** A backticked scope pattern in a routing table, such as packages/star/AGENTS.md or apps/star-star. */
const GLOB_TOKEN_RE = /`([A-Za-z0-9_.@/{},*?-]*\*[A-Za-z0-9_.@/{},*?-]*)`/g;

/** Glob patterns the root uses as scopes, from backticks and link targets. */
function scopeGlobs(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(GLOB_TOKEN_RE)) {
    const token = m[1] ?? "";
    if (token.includes("/") || token.startsWith("*")) out.add(token);
  }
  for (const ref of extractReferences(text)) {
    if (ref.kind === "link" && ref.target.includes("*")) out.add(targetPath(ref.target));
  }
  return [...out];
}

export default defineProbe({
  id: "agent.nested-guides-routed",
  version: "1.0.0",
  dimensions: [{ id: "context", weight: 1 }],
  tier: "static",
  evidence: ["agent_config", "files", "size_stats"],

  rationale: `
    A nested AGENTS.md is loaded only when the agent already works in its
    directory. Whether it ever gets there depends on the root: expo's root
    says "if the directory you will edit contains AGENTS.md, read that file
    too", sentry and cloudflare carry a scope table of glob to file. Without
    that, the field study found, nested guides are scattered files the
    agent never discovers. agent.nested-guidance-lean scores what the
    nested files say; agent.root-routes counts the root's resolving
    references in general, so a root can score 100 there while naming none
    of its nested guides. This probe lists the nested guide directories the
    canonical root does not reference, by file path, by directory, or by a
    scope glob that matches them. Whether the root also states the
    precedence ("closer file wins") is prose and belongs to the
    guidance-quality rubric.
  `,

  remediation:
    "Add a nested-guides table to the root: one row per scoped `AGENTS.md`, named by path (`packages/engine/AGENTS.md`), by directory, or by a scope glob (`packages/*/AGENTS.md`), with one line on what each covers. State once that the closer file wins.",

  async detect(ev) {
    const guides = new Map<string, string[]>();
    for (const file of ev.agent_config.instructionFiles) {
      if (file.depth === 0 || file.link || !NESTED_BASENAMES.has(basename(file.path))) continue;
      const text = await ev.files.readText(file.path);
      if (text === undefined || isPointer(text)) continue;
      const dir = dirname(file.path);
      guides.set(dir, [...(guides.get(dir) ?? []), file.path]);
    }
    if (guides.size === 0) return { kind: "na", reason: "no nested instruction files" };

    const root = await canonicalRoot(ev.agent_config, ev.files);
    if (!root) return { kind: "na", reason: "no root instruction file" };
    const tree = trackedTree(ev.size_stats, ev.agent_config);
    const rootDir = dirname(root.file.path);

    const named = new Set<string>();
    for (const ref of extractReferences(root.text)) {
      if (ref.negated || ref.kind === "skill" || isTemplate(ref.target)) continue;
      const { resolution, path } = resolvePathReference(ref.target, rootDir, tree);
      if (resolution !== "resolves" || path === null) continue;
      if (guides.has(path)) named.add(path);
      else if (NESTED_BASENAMES.has(basename(path)) && guides.has(dirname(path))) {
        named.add(dirname(path));
      }
    }
    for (const glob of scopeGlobs(root.text)) {
      const matcher = compileGlob(glob, rootDir);
      if (!matcher) continue;
      for (const [dir, paths] of guides) {
        if (matcher.test(dir) || paths.some((p) => matcher.test(p))) named.add(dir);
      }
    }

    const items: InventoryItem[] = [];
    for (const [dir, paths] of guides) {
      if (named.has(dir)) continue;
      const path = paths.find((p) => basename(p) === "AGENTS.md") ?? (paths[0] as string);
      items.push({
        location: { path },
        severity: "warn",
        message: `not referenced from ${root.file.path}`,
      });
    }
    items.sort((a, b) => a.location.path.localeCompare(b.location.path));
    return { kind: "inventory", items };
  },

  score: {
    kind: "inventory",
    severityWeights: { info: 0, warn: 1, error: 1 },
    bands: [{ upTo: 0, score: 100 }, { upTo: 1, score: 70 }, { upTo: 3, score: 40 }, { score: 0 }],
  },

  fixtures: [
    {
      name: "root-only",
      evidence: agentFixture({
        files: { "AGENTS.md": "# Project\n\nRun `npm test`.\n", "src/index.ts": "export {};\n" },
      }),
      expect: { reading: { kind: "na", reason: "no nested instruction files" }, score: null },
    },
    {
      name: "nested-without-root",
      evidence: agentFixture({
        files: {
          "packages/engine/AGENTS.md": "# engine\n\nRun `npm test -w engine` before committing.\n",
        },
      }),
      expect: { reading: { kind: "na", reason: "no root instruction file" }, score: null },
    },
    {
      name: "root-names-every-nested-guide",
      evidence: agentFixture({
        files: {
          "AGENTS.md": [
            "# Project",
            "",
            "The closer file wins. Nested guides:",
            "",
            "| Scope | Guide |",
            "|---|---|",
            "| engine | [packages/engine/AGENTS.md](packages/engine/AGENTS.md) |",
            "| corpus | `packages/corpus/` |",
            "| apps | `apps/*/AGENTS.md` |",
            "",
          ].join("\n"),
          "packages/engine/AGENTS.md": "# engine\n\nRun `npm test -w engine` before committing.\n",
          "packages/corpus/AGENTS.md": "# corpus\n\nOne probe per file; fixtures are mandatory.\n",
          "apps/web/AGENTS.md": "# web\n\nUse the design tokens in `src/theme.ts`.\n",
          "apps/web/CLAUDE.md": "@AGENTS.md\n",
          "apps/web/src/theme.ts": "export const tokens = {};\n",
        },
      }),
      expect: { reading: { kind: "inventory", items: [] }, score: 100 },
    },
    {
      name: "root-names-none",
      evidence: agentFixture({
        files: {
          "AGENTS.md": "# Project\n\nBe careful. See [the plan](docs/plan.md).\n",
          "docs/plan.md": "plan\n",
          "packages/engine/AGENTS.md": "# engine\n\nRun `npm test -w engine` before committing.\n",
          "packages/corpus/AGENTS.md": "# corpus\n\nOne probe per file; fixtures are mandatory.\n",
          "apps/web/CLAUDE.md": "# web\n\nUse the design tokens in `src/theme.ts`.\n",
        },
      }),
      expect: {
        reading: {
          kind: "inventory",
          items: [
            {
              location: { path: "apps/web/CLAUDE.md" },
              severity: "warn",
              message: "not referenced from AGENTS.md",
            },
            {
              location: { path: "packages/corpus/AGENTS.md" },
              severity: "warn",
              message: "not referenced from AGENTS.md",
            },
            {
              location: { path: "packages/engine/AGENTS.md" },
              severity: "warn",
              message: "not referenced from AGENTS.md",
            },
          ],
        },
        score: 40,
      },
    },
  ],
});
