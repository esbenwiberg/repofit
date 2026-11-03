import type { InventoryItem } from "@esbenwiberg/repofit/sdk";
import { defineProbe } from "@esbenwiberg/repofit/sdk";
import { agentFixture } from "./_shared/agent-evidence-fixture.js";
import {
  dirname,
  HARNESS_SIBLINGS,
  includeLines,
  isPointer,
  joinPath,
  linkDestination,
} from "./_shared/agent-tree.js";

const CANONICAL = "AGENTS.md";

export default defineProbe({
  id: "agent.harness-adapters-thin",
  version: "1.0.0",
  dimensions: [
    { id: "consistency", weight: 1 },
    { id: "context", weight: 0.5 },
  ],
  tier: "static",
  evidence: ["agent_config", "files"],

  rationale: `
    AGENTS.md is the shared instruction file; CLAUDE.md, GEMINI.md,
    .cursorrules and copilot-instructions.md are the harness-specific doors
    into it. When a door carries its own text the repository has two
    sources of truth, and the field study shows they drift within months:
    one file names a command the other has renamed, one keeps a rule the
    other dropped. A thin adapter is a symlink to AGENTS.md or a file whose
    only content is an include of it. Anything else is a copy that will
    drift, a parallel that already has, or a dangling link.
  `,

  remediation:
    "Make each harness file a symlink to `AGENTS.md` (`ln -s AGENTS.md CLAUDE.md`), or a one-line pointer containing only `@AGENTS.md`. Move any harness-specific content into the harness's own settings or rules directory.",

  async detect(ev) {
    const files = ev.agent_config.instructionFiles;
    const byPath = new Map(files.map((f) => [f.path, f]));
    const canonicals = files.filter((f) => f.path.endsWith(CANONICAL) && !f.link);
    if (canonicals.length === 0) return { kind: "na", reason: "no AGENTS.md to adapt to" };

    const items: InventoryItem[] = [];
    let siblings = 0;
    for (const canonical of canonicals) {
      const dir = dirname(canonical.path);
      for (const name of HARNESS_SIBLINGS) {
        const path = dir === "" ? name : `${dir}/${name}`;
        const sibling = byPath.get(path);
        if (!sibling) continue;
        siblings++;
        if (sibling.link) {
          const target = sibling.link.targetExists
            ? linkDestination(sibling.path, sibling.link)
            : null;
          if (target === canonical.path) continue;
          items.push({
            location: { path },
            severity: "warn",
            message: sibling.link.targetExists
              ? `links to ${target ?? sibling.link.target}, not ${canonical.path}`
              : `dangling link to ${sibling.link.target}`,
          });
          continue;
        }
        const text = await ev.files.readText(path);
        if (text === undefined) continue;
        if (isPointer(text)) {
          const targets = includeLines(text).map((inc) => joinPath(dirname(path), inc));
          if (targets.includes(canonical.path)) continue;
          items.push({
            location: { path },
            severity: "warn",
            message: `pointer does not include ${canonical.path}`,
          });
          continue;
        }
        items.push({
          location: { path },
          severity: "warn",
          message:
            sibling.sha256 === canonical.sha256
              ? `byte-identical copy of ${canonical.path}; link or include it instead`
              : `drifted parallel of ${canonical.path}: its own content, two sources of truth`,
        });
      }
    }
    if (siblings === 0) return { kind: "na", reason: "no harness file beside an AGENTS.md" };
    items.sort((a, b) => a.location.path.localeCompare(b.location.path));
    return { kind: "inventory", items };
  },

  score: {
    kind: "inventory",
    severityWeights: { info: 0, warn: 1, error: 1 },
    bands: [{ upTo: 0, score: 100 }, { upTo: 1, score: 60 }, { score: 0 }],
  },

  fixtures: [
    {
      name: "no-agents-md",
      evidence: agentFixture({ files: { "CLAUDE.md": "# only claude\n" } }),
      expect: { reading: { kind: "na", reason: "no AGENTS.md to adapt to" }, score: null },
    },
    {
      name: "agents-md-alone",
      evidence: agentFixture({ files: { "AGENTS.md": "# shared\n" } }),
      expect: {
        reading: { kind: "na", reason: "no harness file beside an AGENTS.md" },
        score: null,
      },
    },
    {
      name: "link-and-pointer-adapters",
      evidence: agentFixture({
        files: {
          "AGENTS.md": "# shared\n",
          "GEMINI.md": "@AGENTS.md\n",
          "src/AGENTS.md": "# scoped\n",
          "src/CLAUDE.md": "@AGENTS.md\n",
        },
        links: { "CLAUDE.md": "AGENTS.md" },
      }),
      expect: { reading: { kind: "inventory", items: [] }, score: 100 },
    },
    {
      name: "copy-drift-and-dangling",
      evidence: agentFixture({
        files: {
          "AGENTS.md": "# shared\n",
          "CLAUDE.md": "# shared\n",
          "GEMINI.md": "# gemini\n\nDifferent rules here.\n",
          ".github/copilot-instructions.md": "@README.md\n",
          "README.md": "readme\n",
        },
        links: { ".cursorrules": "missing.md" },
      }),
      expect: {
        reading: {
          kind: "inventory",
          items: [
            {
              location: { path: ".cursorrules" },
              severity: "warn",
              message: "dangling link to missing.md",
            },
            {
              location: { path: ".github/copilot-instructions.md" },
              severity: "warn",
              message: "pointer does not include AGENTS.md",
            },
            {
              location: { path: "CLAUDE.md" },
              severity: "warn",
              message: "byte-identical copy of AGENTS.md; link or include it instead",
            },
            {
              location: { path: "GEMINI.md" },
              severity: "warn",
              message: "drifted parallel of AGENTS.md: its own content, two sources of truth",
            },
          ],
        },
        score: 0,
      },
    },
  ],
});
