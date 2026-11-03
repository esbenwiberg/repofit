import type { InventoryItem, SkillFile } from "@esbenwiberg/repofit/sdk";
import { defineProbe } from "@esbenwiberg/repofit/sdk";
import { agentFixture } from "./_shared/agent-evidence-fixture.js";
import { skillName } from "./_shared/agent-tree.js";

const SHARED_ROOT = ".agents/skills";

function isLinked(skill: SkillFile): boolean {
  return skill.link !== null || skill.dirLink !== null;
}

function pickCanonical(skills: readonly SkillFile[]): string {
  const roots = new Map<string, number>();
  for (const s of skills) roots.set(s.root, (roots.get(s.root) ?? 0) + (isLinked(s) ? 0 : 1));
  if (roots.has(SHARED_ROOT)) return SHARED_ROOT;
  return [...roots.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
}

export default defineProbe({
  id: "agent.skills-single-source",
  version: "1.0.0",
  dimensions: [{ id: "consistency", weight: 1 }],
  tier: "static",
  evidence: ["agent_config"],

  rationale: `
    Harnesses read skills from their own directories, so a repository that
    serves more than one keeps several roots. The field study's tidy
    repositories keep one real root (\`.agents/skills\`) and link the
    others onto it; the untidy ones copy, and the copies drift until two
    harnesses follow different procedures for the same task. This probe
    accepts a linked root directory, linked skill directories or linked
    SKILL.md files, and flags copies, drifted copies and dangling links.
  `,

  remediation:
    "Keep `.agents/skills` as the only real root and replace each other root with a directory link (`ln -s ../.agents/skills .claude/skills`), or link each skill directory. Delete drifted copies after merging their differences into the canonical skill.",

  async detect(ev) {
    const skills = ev.agent_config.skills;
    const roots = new Set(skills.map((s) => s.root));
    if (skills.length === 0) return { kind: "na", reason: "no skills" };
    if (roots.size < 2) return { kind: "na", reason: "skills under one root" };
    const canonical = pickCanonical(skills);
    const canonicalSkills = skills.filter((s) => s.root === canonical);
    const byHash = new Map(canonicalSkills.map((s) => [s.sha256, s]));
    const byName = new Map(canonicalSkills.map((s) => [skillName(s), s]));
    const items: InventoryItem[] = [];
    for (const skill of skills) {
      if (skill.root === canonical) continue;
      const link = skill.dirLink ?? skill.link;
      if (link) {
        if (!link.targetExists) {
          items.push({
            location: { path: skill.path },
            severity: "warn",
            message: `dangling link to ${link.target}`,
          });
        }
        continue;
      }
      const same = byHash.get(skill.sha256);
      if (same) {
        items.push({
          location: { path: skill.path },
          severity: "warn",
          message: `copy of ${same.path}; link it instead`,
        });
        continue;
      }
      const named = byName.get(skillName(skill));
      if (named) {
        items.push({
          location: { path: skill.path },
          severity: "warn",
          message: `drifted copy of ${named.path}: same name, different content`,
        });
        continue;
      }
      items.push({
        location: { path: skill.path },
        severity: "info",
        message: `only under ${skill.root}; move it to ${canonical} so every harness sees it`,
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
      name: "one-root",
      evidence: agentFixture({
        files: { ".agents/skills/a/SKILL.md": "---\nname: a\n---\nbody\n" },
      }),
      expect: { reading: { kind: "na", reason: "skills under one root" }, score: null },
    },
    {
      name: "linked-root",
      evidence: agentFixture({
        files: { ".agents/skills/a/SKILL.md": "---\nname: a\n---\nbody\n" },
        links: { ".claude/skills": "../.agents/skills" },
      }),
      expect: { reading: { kind: "inventory", items: [] }, score: 100 },
    },
    {
      name: "copy-drift-dangling-and-unique",
      evidence: agentFixture({
        files: {
          ".agents/skills/a/SKILL.md": "---\nname: a\n---\nbody\n",
          ".agents/skills/b/SKILL.md": "---\nname: b\n---\nbody b\n",
          ".claude/skills/a/SKILL.md": "---\nname: a\n---\nbody\n",
          ".claude/skills/b/SKILL.md": "---\nname: b\n---\nbody b, edited\n",
          ".codex/skills/c/SKILL.md": "---\nname: c\n---\nbody c\n",
        },
        links: { ".claude/skills/d": "../../.agents/skills/missing" },
      }),
      expect: {
        reading: {
          kind: "inventory",
          items: [
            {
              location: { path: ".claude/skills/a/SKILL.md" },
              severity: "warn",
              message: "copy of .agents/skills/a/SKILL.md; link it instead",
            },
            {
              location: { path: ".claude/skills/b/SKILL.md" },
              severity: "warn",
              message: "drifted copy of .agents/skills/b/SKILL.md: same name, different content",
            },
            {
              location: { path: ".claude/skills/d/SKILL.md" },
              severity: "warn",
              message: "dangling link to ../../.agents/skills/missing",
            },
            {
              location: { path: ".codex/skills/c/SKILL.md" },
              severity: "info",
              message:
                "only under .codex/skills; move it to .agents/skills so every harness sees it",
            },
          ],
        },
        score: 40,
      },
    },
  ],
});
