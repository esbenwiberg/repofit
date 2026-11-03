import { defineProbe } from "@esbenwiberg/repofit/sdk";
import { agentFixture } from "./_shared/agent-evidence-fixture.js";
import { canonicalRoot, dirname, resolveIncludes } from "./_shared/agent-tree.js";

const KIB = 1024;

export default defineProbe({
  id: "agent.root-budget",
  version: "1.0.0",
  dimensions: [
    { id: "context", weight: 1 },
    { id: "cost", weight: 0.5 },
  ],
  tier: "static",
  evidence: ["agent_config", "files"],

  rationale: `
    The root instruction file loads into every session before the agent
    has read a line of code. Past a few kilobytes it stops being a map and
    becomes a manual the agent skims, and every rule it holds competes with
    the task for attention. The field study's well-run roots sit under
    6 KB and route elsewhere; the 30–50 KB roots are the ones whose own
    maintainers describe as "nobody reads it all". This probe measures the
    effective size after \`@include\` lines are resolved, so splitting a
    fat root into included parts does not hide it.
  `,

  remediation:
    "Move rules into scoped guides (`src/<area>/AGENTS.md`), skills or `docs/`, and leave a routing table in the root that says where to read for which task. If the repository deliberately keeps a large root and measures it with its own test, waive this probe in `repofit.config.json` with that reason rather than trimming for the score.",

  async detect(ev) {
    const root = await canonicalRoot(ev.agent_config, ev.files);
    if (!root) return { kind: "na", reason: "no root instruction file" };
    const effective = await resolveIncludes(root.text, dirname(root.file.path), ev.files);
    return { kind: "magnitude", value: Buffer.byteLength(effective, "utf8"), unit: "bytes" };
  },

  score: {
    kind: "magnitude",
    direction: "negative",
    bands: [
      { upTo: 6 * KIB, score: 100 },
      { upTo: 12 * KIB, score: 85 },
      { upTo: 24 * KIB, score: 60 },
      { upTo: 48 * KIB, score: 30 },
      { score: 0 },
    ],
  },

  fixtures: [
    {
      name: "no-root",
      evidence: agentFixture({ files: { "src/AGENTS.md": "# nested only\n" } }),
      expect: { reading: { kind: "na", reason: "no root instruction file" }, score: null },
    },
    {
      name: "lean-root",
      evidence: agentFixture({ files: { "AGENTS.md": "# Project\n\nRun `npm test`.\n" } }),
      expect: { reading: { kind: "magnitude", value: 27, unit: "bytes" }, score: 100 },
    },
    {
      name: "includes-count-toward-the-budget",
      evidence: agentFixture({
        files: {
          "AGENTS.md": "# Root\n@docs/rules.md\n",
          "docs/rules.md": `${"x".repeat(7 * KIB)}\n`,
        },
      }),
      expect: { reading: { kind: "magnitude", value: 7 * KIB + 9, unit: "bytes" }, score: 85 },
    },
    {
      name: "pointer-claude-md-is-not-the-root",
      evidence: agentFixture({
        files: { "CLAUDE.md": "@docs/big.md\n", "docs/big.md": "y".repeat(30 * KIB) },
      }),
      expect: { reading: { kind: "na", reason: "no root instruction file" }, score: null },
    },
    {
      name: "manual-root",
      evidence: agentFixture({ files: { "CLAUDE.md": "z".repeat(50 * KIB) } }),
      expect: { reading: { kind: "magnitude", value: 50 * KIB, unit: "bytes" }, score: 0 },
    },
  ],
});
