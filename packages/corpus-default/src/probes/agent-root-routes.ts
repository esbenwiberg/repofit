import type { Location } from "@esbenwiberg/repofit/sdk";
import { defineProbe } from "@esbenwiberg/repofit/sdk";
import { agentFixture } from "./_shared/agent-evidence-fixture.js";
import {
  extractReferences,
  isTemplate,
  resolvePathReference,
  skillNames,
} from "./_shared/agent-references.js";
import { canonicalRoot, dirname, trackedTree } from "./_shared/agent-tree.js";

export default defineProbe({
  id: "agent.root-routes",
  version: "1.0.0",
  dimensions: [{ id: "context", weight: 1 }],
  tier: "static",
  evidence: ["agent_config", "files", "size_stats"],

  rationale: `
    A small root is only useful if it routes: links to scoped guides,
    skills, docs and the places a task starts. A 1.4 KB root with no
    pointers is thin, not lean; the agent has nowhere to go next. This
    counts the distinct repository-internal references in the canonical
    root that actually resolve: markdown links, backticked paths,
    \`/skill\` mentions that match a skill, and \`@include\` lines. Broken
    ones are not counted here; \`agent.references-resolve\` reports them.
  `,

  remediation:
    "Turn the root into a routing table: for each kind of task, name the scoped `AGENTS.md`, skill (`/name`), design doc or script to read first. Link with relative markdown links or backticked paths so the pointers can be checked.",

  async detect(ev) {
    const root = await canonicalRoot(ev.agent_config, ev.files);
    if (!root) return { kind: "na", reason: "no root instruction file" };
    const tree = trackedTree(ev.size_stats, ev.agent_config);
    const names = skillNames(ev.agent_config.skills);
    const dir = dirname(root.file.path);
    const resolved = new Map<string, Location>();
    for (const ref of extractReferences(root.text)) {
      if (isTemplate(ref.target) || ref.negated) continue;
      if (ref.kind === "skill") {
        if (names.has(ref.target) && !resolved.has(`/${ref.target}`)) {
          resolved.set(`/${ref.target}`, { path: root.file.path, range: { startLine: ref.line } });
        }
        continue;
      }
      const { resolution, path } = resolvePathReference(ref.target, dir, tree);
      if (resolution === "resolves" && path !== null && !resolved.has(path)) {
        resolved.set(path, { path, range: { startLine: ref.line } });
      }
    }
    const samples = [...resolved.values()].sort((a, b) => a.path.localeCompare(b.path));
    return { kind: "count", value: samples.length, samples };
  },

  score: {
    kind: "count",
    direction: "positive",
    bands: [{ upTo: 0, score: 0 }, { upTo: 2, score: 50 }, { upTo: 5, score: 80 }, { score: 100 }],
  },

  fixtures: [
    {
      name: "no-root",
      evidence: agentFixture({ files: {} }),
      expect: { reading: { kind: "na", reason: "no root instruction file" }, score: null },
    },
    {
      name: "thin-root-routes-nowhere",
      evidence: agentFixture({ files: { "AGENTS.md": "# Project\n\nBe careful.\n" } }),
      expect: { reading: { kind: "count", value: 0, samples: [] }, score: 0 },
    },
    {
      name: "routing-root",
      evidence: agentFixture({
        files: {
          "AGENTS.md": [
            "# Project",
            "",
            "Read [domain](src/domain/AGENTS.md) and [the plan](docs/plan.md).",
            "Commit with `/commit`; see `scripts/check.py`.",
            "Broken: [gone](docs/missing.md) and `/nope` and `<placeholder>/x.md`.",
            "@docs/shared.md",
            "",
          ].join("\n"),
          "src/domain/AGENTS.md": "# domain\n",
          "docs/plan.md": "plan\n",
          "docs/shared.md": "shared\n",
          "scripts/check.py": "print(1)\n",
          ".agents/skills/commit/SKILL.md":
            "---\nname: commit\ndescription: Use when committing.\n---\n",
        },
      }),
      expect: {
        reading: {
          kind: "count",
          value: 5,
          samples: [
            { path: "AGENTS.md", range: { startLine: 4 } },
            { path: "docs/plan.md", range: { startLine: 3 } },
            { path: "docs/shared.md", range: { startLine: 6 } },
            { path: "scripts/check.py", range: { startLine: 4 } },
            { path: "src/domain/AGENTS.md", range: { startLine: 3 } },
          ],
        },
        score: 80,
      },
    },
  ],
});
