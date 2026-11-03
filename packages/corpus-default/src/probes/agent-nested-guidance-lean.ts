import type { InventoryItem } from "@esbenwiberg/repofit/sdk";
import { defineProbe } from "@esbenwiberg/repofit/sdk";
import { agentFixture } from "./_shared/agent-evidence-fixture.js";
import {
  basename,
  canonicalRoot,
  dirname,
  isPointer,
  stripFrontmatter,
} from "./_shared/agent-tree.js";

const STUB_BYTES = 200;
const MANUAL_BYTES = 24 * 1024;
const CHAIN_BYTES = 32 * 1024;
const RESTATED_LINES = 3;
const RESTATED_MIN_CHARS = 40;

/** Scoped guides proper; per-topic rule collections are small by design and not judged here. */
const NESTED_BASENAMES = new Set(["AGENTS.md", "CLAUDE.md", "GEMINI.md"]);
const URL_ONLY_RE = /^https?:\/\/\S+$/;
const INCLUDE_RE = /^@\S/;

function substantiveLines(text: string): string[] {
  return stripFrontmatter(text)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !INCLUDE_RE.test(l) && !URL_ONLY_RE.test(l));
}

function comparableLines(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of substantiveLines(text)) {
    if (line.length < RESTATED_MIN_CHARS) continue;
    if (line.startsWith("#")) continue;
    if (/^\|?[\s:|-]+\|?$/.test(line)) continue;
    out.add(line);
  }
  return out;
}

export default defineProbe({
  id: "agent.nested-guidance-lean",
  version: "1.0.0",
  dimensions: [
    { id: "context", weight: 1 },
    { id: "cost", weight: 0.3 },
  ],
  tier: "static",
  evidence: ["agent_config", "files"],

  rationale: `
    A scoped AGENTS.md or CLAUDE.md below the root is loaded on top of the
    root whenever the agent works in that directory. It earns its place by
    saying what is different here. The field study's failure modes are a
    stub that says nothing (or only a URL), a manual that dwarfs the root,
    a restatement of root rules that doubles the context for no new
    information, and a chain of nested files that overflows the smallest
    documented loader budget (32 KiB). A repository with only a root is
    fine; nothing here asks every package to have a guide.
  `,

  remediation:
    "Delete stubs or give them the directory's own conventions. Move manuals into `docs/` and leave a pointer. Remove lines that restate the root; the root is already loaded. Keep root plus every ancestor guide under 32 KiB.",

  async detect(ev) {
    const nested = ev.agent_config.instructionFiles.filter(
      (f) => f.depth > 0 && !f.link && NESTED_BASENAMES.has(basename(f.path)),
    );
    if (nested.length === 0) return { kind: "na", reason: "no nested instruction files" };
    const root = await canonicalRoot(ev.agent_config, ev.files);
    const rootLines = root ? comparableLines(root.text) : new Set<string>();
    const rootBytes = root?.file.bytes ?? 0;
    const byPath = new Map(ev.agent_config.instructionFiles.map((f) => [f.path, f]));
    const items: InventoryItem[] = [];

    for (const file of nested) {
      const text = await ev.files.readText(file.path);
      if (text === undefined) continue;
      if (isPointer(text)) continue;
      const reasons: string[] = [];
      const lines = substantiveLines(text);
      const contentBytes = Buffer.byteLength(lines.join("\n"), "utf8");
      if (contentBytes < STUB_BYTES) {
        reasons.push(`stub: ${contentBytes} bytes of content`);
      }
      if (file.bytes > MANUAL_BYTES) {
        reasons.push(`manual: ${file.bytes} bytes, over ${MANUAL_BYTES}`);
      }
      if (rootLines.size > 0) {
        let restated = 0;
        for (const line of comparableLines(text)) if (rootLines.has(line)) restated++;
        if (restated >= RESTATED_LINES) reasons.push(`restates ${restated} root lines`);
      }
      let chain = rootBytes + file.bytes;
      for (let dir = dirname(file.path); dir !== ""; dir = dirname(dir)) {
        if (dir === dirname(file.path)) continue;
        for (const name of NESTED_BASENAMES) {
          const ancestor = byPath.get(`${dir}/${name}`);
          if (ancestor && !ancestor.link) chain += ancestor.bytes;
        }
      }
      if (chain > CHAIN_BYTES) reasons.push(`chain: ${chain} bytes loaded with the root`);
      if (reasons.length > 0) {
        items.push({
          location: { path: file.path },
          severity: "warn",
          message: reasons.join("; "),
        });
      }
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
      evidence: agentFixture({ files: { "AGENTS.md": "# root\n" } }),
      expect: { reading: { kind: "na", reason: "no nested instruction files" }, score: null },
    },
    {
      name: "lean-scoped-guide",
      evidence: agentFixture({
        files: {
          "AGENTS.md": "# root\n",
          "src/domain/AGENTS.md": `# Domain\n\n${"Keep business math pure; no IO in this layer. ".repeat(6)}\n`,
          "src/domain/CLAUDE.md": "@AGENTS.md\n",
        },
      }),
      expect: { reading: { kind: "inventory", items: [] }, score: 100 },
    },
    {
      name: "stub-and-url-only",
      evidence: agentFixture({
        files: {
          "AGENTS.md": "# root\n",
          "packages/a/CLAUDE.md": "# a\n\nSee the docs.\n",
          "packages/b/AGENTS.md": "https://example.com/handbook\n",
        },
      }),
      expect: {
        reading: {
          kind: "inventory",
          items: [
            {
              location: { path: "packages/a/CLAUDE.md" },
              severity: "warn",
              message: "stub: 17 bytes of content",
            },
            {
              location: { path: "packages/b/AGENTS.md" },
              severity: "warn",
              message: "stub: 0 bytes of content",
            },
          ],
        },
        score: 40,
      },
    },
    {
      name: "restatement-and-manual",
      evidence: agentFixture({
        files: {
          "AGENTS.md": [
            "# root",
            "- Always run the full test suite before you open a pull request.",
            "- Never commit secrets, tokens or credentials to the repository.",
            "- Use conventional commit messages with a scope for every change.",
            "| --- | --- |",
          ].join("\n"),
          "apps/web/AGENTS.md": [
            "# web",
            "- Always run the full test suite before you open a pull request.",
            "- Never commit secrets, tokens or credentials to the repository.",
            "- Use conventional commit messages with a scope for every change.",
            "| --- | --- |",
            "x".repeat(25 * 1024),
          ].join("\n"),
        },
      }),
      expect: {
        reading: {
          kind: "inventory",
          items: [
            {
              location: { path: "apps/web/AGENTS.md" },
              severity: "warn",
              message: "manual: 25816 bytes, over 24576; restates 3 root lines",
            },
          ],
        },
        score: 70,
      },
    },
    {
      name: "chain-overflow",
      evidence: agentFixture({
        files: {
          "AGENTS.md": "r".repeat(22 * 1024),
          "src/AGENTS.md": "s".repeat(10 * 1024),
          "src/app/AGENTS.md": `${"Scoped guidance for the application layer. ".repeat(6)}\n`,
        },
      }),
      expect: {
        reading: {
          kind: "inventory",
          items: [
            {
              location: { path: "src/app/AGENTS.md" },
              severity: "warn",
              message: "chain: 33027 bytes loaded with the root",
            },
          ],
        },
        score: 70,
      },
    },
  ],
});
