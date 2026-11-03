import type { InventoryItem } from "@esbenwiberg/repofit/sdk";
import { defineProbe } from "@esbenwiberg/repofit/sdk";
import { agentFixture } from "./_shared/agent-evidence-fixture.js";
import { basename } from "./_shared/agent-tree.js";

const SHARED_SKILLS_ROOT = ".agents/skills";
const TOKENS = ["${{", "<read_file>", "<execute_command>", "<attempt_completion>", "<corridor>"];

function isShared(path: string, root: string | null): boolean {
  if (basename(path) === "AGENTS.md") return true;
  return root !== null && (root === SHARED_SKILLS_ROOT || root.endsWith(`/${SHARED_SKILLS_ROOT}`));
}

export default defineProbe({
  id: "agent.shared-files-portable",
  version: "1.0.0",
  dimensions: [{ id: "consistency", weight: 0.7 }],
  tier: "static",
  evidence: ["agent_config", "files"],

  rationale: `
    AGENTS.md and \`.agents/skills\` exist so that every harness reads the
    same instructions. One harness's syntax inside them (GitHub Actions
    templating, another tool's XML tool-call tags, vendor steering blocks)
    is noise or a misfire for every other harness. Harness-specific files
    such as CLAUDE.md or \`.claude/**\` are exempt; carrying that syntax is
    their job.
  `,

  remediation:
    "Move harness-specific syntax out of `AGENTS.md` and `.agents/skills/**` into that harness's own file (`CLAUDE.md`, `.claude/rules/`, `.cursor/rules/`), and keep the shared files in plain markdown.",

  async detect(ev) {
    const shared = [
      ...ev.agent_config.instructionFiles.filter((f) => !f.link && isShared(f.path, null)),
      ...ev.agent_config.skills.filter((s) => !s.link && !s.dirLink && isShared(s.path, s.root)),
    ];
    if (shared.length === 0) return { kind: "na", reason: "no shared instruction files" };
    const items: InventoryItem[] = [];
    for (const file of shared) {
      const text = await ev.files.readText(file.path);
      if (text === undefined) continue;
      for (const [i, line] of text.split("\n").entries()) {
        const token = TOKENS.find((t) => line.includes(t));
        if (!token) continue;
        items.push({
          location: { path: file.path, range: { startLine: i + 1 } },
          severity: "warn",
          message: `${token} is one harness's syntax in a shared file`,
        });
        break;
      }
    }
    return { kind: "inventory", items };
  },

  score: {
    kind: "inventory",
    severityWeights: { info: 0, warn: 1, error: 1 },
    bands: [{ upTo: 0, score: 100 }, { upTo: 1, score: 50 }, { score: 0 }],
  },

  fixtures: [
    {
      name: "no-shared-files",
      evidence: agentFixture({ files: { "CLAUDE.md": "<corridor>fine here</corridor>\n" } }),
      expect: { reading: { kind: "na", reason: "no shared instruction files" }, score: null },
    },
    {
      name: "portable",
      evidence: agentFixture({
        files: {
          "AGENTS.md": "# shared\n",
          ".agents/skills/a/SKILL.md": "---\nname: a\n---\nplain\n",
          ".claude/skills/b/SKILL.md": "---\nname: b\n---\n<read_file>exempt</read_file>\n",
        },
      }),
      expect: { reading: { kind: "inventory", items: [] }, score: 100 },
    },
    {
      name: "actions-templating-in-root-and-tool-tags-in-skill",
      evidence: agentFixture({
        files: {
          "AGENTS.md": "# shared\n\nUse $" + "{{ secrets.TOKEN }} here.\n",
          ".agents/skills/a/SKILL.md": "---\nname: a\n---\n<execute_command>ls</execute_command>\n",
        },
      }),
      expect: {
        reading: {
          kind: "inventory",
          items: [
            {
              location: { path: "AGENTS.md", range: { startLine: 3 } },
              severity: "warn",
              message: "${{ is one harness's syntax in a shared file",
            },
            {
              location: { path: ".agents/skills/a/SKILL.md", range: { startLine: 4 } },
              severity: "warn",
              message: "<execute_command> is one harness's syntax in a shared file",
            },
          ],
        },
        score: 0,
      },
    },
  ],
});
