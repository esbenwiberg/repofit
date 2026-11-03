import type { InventoryItem } from "@esbenwiberg/repofit/sdk";
import { defineProbe } from "@esbenwiberg/repofit/sdk";
import { agentFixture } from "./_shared/agent-evidence-fixture.js";
import {
  extractReferences,
  isTemplate,
  isUntrackedByDesign,
  resolvePathReference,
  skillNames,
} from "./_shared/agent-references.js";
import { dirname, trackedTree } from "./_shared/agent-tree.js";

const HOOK_SCRIPT_RE =
  /(?:^|\s)(?:node|python3?|bash|sh|\.\/)\s*((?:\.?\/)?[A-Za-z0-9_@][A-Za-z0-9_.@/-]*\.[A-Za-z0-9]{1,8})/g;

function hookCommands(json: unknown, out: string[] = []): string[] {
  if (Array.isArray(json)) for (const v of json) hookCommands(v, out);
  else if (json && typeof json === "object") {
    for (const [k, v] of Object.entries(json)) {
      if (k === "command" && typeof v === "string") out.push(v);
      else hookCommands(v, out);
    }
  }
  return out;
}

export default defineProbe({
  id: "agent.references-resolve",
  version: "1.0.0",
  dimensions: [
    { id: "context", weight: 1 },
    { id: "consistency", weight: 0.7 },
  ],
  tier: "static",
  evidence: ["agent_config", "files", "size_stats"],

  rationale: `
    A pointer to a file that is not there costs the agent a read, a wrong
    turn and some trust in the rest of the guidance. The field study found
    skills named in roots that were never written, paths kept after a
    rename, and hook commands aimed at scripts that moved. A reference is
    blind when its parent directory exists but the target does not, when
    it is a \`/skill\` no skill answers to, or when it is a link whose
    target is missing. A path whose parent does not exist either is a
    documentation example, not a pointer, and is left alone.
  `,

  remediation:
    "Fix or remove each blind pointer: update the path if the file moved (`git log --diff-filter=R` finds renames), write the skill the root promises, or delete the reference. Replace placeholder paths with `<angle-bracket>` templates so they are recognisably examples.",

  async detect(ev) {
    const agent = ev.agent_config;
    if (agent.instructionFiles.length === 0) return { kind: "na", reason: "no instruction files" };
    const tree = trackedTree(ev.size_stats, agent);
    const names = skillNames(agent.skills);
    const items: InventoryItem[] = [];
    const blind = (path: string, line: number | undefined, message: string) =>
      items.push({
        location: line === undefined ? { path } : { path, range: { startLine: line } },
        severity: "warn",
        message,
      });

    const sources = [
      ...agent.instructionFiles.map((f) => ({ path: f.path, link: f.link })),
      ...agent.skills.map((s) => ({ path: s.path, link: s.link ?? s.dirLink })),
    ];
    for (const source of sources) {
      if (source.link) {
        if (!source.link.targetExists)
          blind(source.path, undefined, `dangling link to ${source.link.target}`);
        continue;
      }
      const text = await ev.files.readText(source.path);
      if (text === undefined) continue;
      const dir = dirname(source.path);
      const seen = new Set<string>();
      for (const ref of extractReferences(text)) {
        if (isTemplate(ref.target) || isUntrackedByDesign(ref.target) || ref.negated) continue;
        const key = `${ref.kind}:${ref.target}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (ref.kind === "skill") {
          if (!names.has(ref.target))
            blind(source.path, ref.line, `/${ref.target}: no skill with that name`);
          continue;
        }
        const { resolution, path } = resolvePathReference(ref.target, dir, tree);
        if (resolution === "blind")
          blind(source.path, ref.line, `${ref.target}: ${path} is not tracked`);
      }
    }
    for (const config of agent.harnessConfig) {
      if (config.link || config.json === null) continue;
      const seen = new Set<string>();
      for (const command of hookCommands(config.json)) {
        for (const m of command.matchAll(HOOK_SCRIPT_RE)) {
          const target = m[1] ?? "";
          if (seen.has(target) || isTemplate(target) || isUntrackedByDesign(target)) continue;
          seen.add(target);
          const { resolution, path } = resolvePathReference(target, "", tree);
          if (resolution === "blind")
            blind(config.path, undefined, `hook command names ${path}, which is not tracked`);
        }
      }
    }
    items.sort(
      (a, b) =>
        a.location.path.localeCompare(b.location.path) ||
        (a.location.range?.startLine ?? 0) - (b.location.range?.startLine ?? 0),
    );
    return { kind: "inventory", items };
  },

  score: {
    kind: "inventory",
    severityWeights: { info: 0, warn: 1, error: 1 },
    bands: [{ upTo: 0, score: 100 }, { upTo: 1, score: 70 }, { upTo: 3, score: 40 }, { score: 0 }],
  },

  fixtures: [
    {
      name: "no-instruction-files",
      evidence: agentFixture({ files: { "README.md": "hi\n" } }),
      expect: { reading: { kind: "na", reason: "no instruction files" }, score: null },
    },
    {
      name: "all-resolve-and-examples-negations-and-bare-names-are-skipped",
      evidence: agentFixture({
        files: {
          "AGENTS.md": [
            "See [guide](docs/guide.md), `src/app/main.ts`, `/commit` and @docs/shared.md.",
            "Example layout: `src/your-module/index.ts` and `<package>/README.md`.",
            "Build output in `dist/index.js`; see https://example.com/docs/x.md.",
            "No `CHANGELOG.md` discipline; do not add `src/helpers/`.",
            "Name probe files like `size-large-files.ts`; imports end in `.js`.",
            "- If you are tempted to add",
            "  `src/helpers/`, it belongs inside the stage that needs it.",
          ].join("\n"),
          "docs/guide.md": "g\n",
          "docs/shared.md": "s\n",
          "src/app/main.ts": "x\n",
          ".agents/skills/commit/SKILL.md": "---\nname: commit\n---\nbody\n",
        },
      }),
      expect: { reading: { kind: "inventory", items: [] }, score: 100 },
    },
    {
      name: "blind-path-phantom-skill-dangling-link-and-hook",
      evidence: agentFixture({
        files: {
          "AGENTS.md": "Read [arch](docs/arch.md) then run `/release`.\n",
          "docs/guide.md": "g\n",
          ".claude/settings.json": JSON.stringify({
            hooks: {
              PreToolUse: [{ hooks: [{ type: "command", command: "node scripts/guard.js" }] }],
            },
          }),
          "scripts/other.js": "",
        },
        links: { "CLAUDE.md": "GEMINI.md" },
      }),
      expect: {
        reading: {
          kind: "inventory",
          items: [
            {
              location: { path: ".claude/settings.json" },
              severity: "warn",
              message: "hook command names scripts/guard.js, which is not tracked",
            },
            {
              location: { path: "AGENTS.md", range: { startLine: 1 } },
              severity: "warn",
              message: "docs/arch.md: docs/arch.md is not tracked",
            },
            {
              location: { path: "AGENTS.md", range: { startLine: 1 } },
              severity: "warn",
              message: "/release: no skill with that name",
            },
            {
              location: { path: "CLAUDE.md" },
              severity: "warn",
              message: "dangling link to GEMINI.md",
            },
          ],
        },
        score: 0,
      },
    },
  ],
});
