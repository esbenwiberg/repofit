import type { HarnessConfigFile, InventoryItem } from "@esbenwiberg/repofit/sdk";
import { defineProbe } from "@esbenwiberg/repofit/sdk";
import { agentFixture } from "./_shared/agent-evidence-fixture.js";
import { dirname } from "./_shared/agent-tree.js";
import { generatedFiles } from "./_shared/generated-files.js";
import { compileGlob, type GlobMatcher } from "./_shared/glob.js";

/**
 * Shared project settings only. `settings.local.json` is one machine's
 * allowlist (and `agent.local-settings-not-committed` says it should not be
 * tracked), so a deny that lives there protects nobody else.
 */
const POLICY_FILE_RE = /(^|\/)\.claude\/settings\.json$/;
/** A permission rule for a tool that writes files: `Edit(**\/gen/**)`, `Write`, `MultiEdit(x)`. */
const WRITE_RULE_RE = /^(?:Edit|Write|MultiEdit|NotebookEdit)(?:\((.*)\))?$/;

function policyFiles(harness: readonly HarnessConfigFile[]): HarnessConfigFile[] {
  return harness.filter((h) => POLICY_FILE_RE.test(h.path));
}

/** Every write-tool deny rule in the shared policies, compiled relative to the policy's project directory. */
function denyMatchers(policies: readonly HarnessConfigFile[]): GlobMatcher[] {
  const out: GlobMatcher[] = [];
  for (const policy of policies) {
    const base = dirname(dirname(policy.path));
    const json = policy.json as { permissions?: { deny?: unknown } } | null;
    const deny = json?.permissions?.deny;
    if (!Array.isArray(deny)) continue;
    for (const rule of deny) {
      if (typeof rule !== "string") continue;
      const m = WRITE_RULE_RE.exec(rule.trim());
      if (!m) continue;
      const matcher = compileGlob(m[1] ?? "**", base);
      if (matcher) out.push(matcher);
    }
  }
  return out;
}

export default defineProbe({
  id: "agent.generated-paths-protected",
  version: "1.0.0",
  dimensions: [{ id: "safety", weight: 0.3 }],
  tier: "static",
  evidence: ["agent_config", "files", "size_stats"],

  rationale: `
    Generated code is regenerated from a schema or template; an agent that
    edits the artifact loses its change on the next build and may ship a
    file that no longer matches its source. Prose in the root ("do not edit
    generated files") is advice. A harness permission deny on the generated
    paths (supabase: Edit(**/__generated__/**)) is enforcement: the edit
    tool refuses, no reading required. This probe takes every tracked file
    that is generated (marked linguist-generated, or recognisable by path
    or header, lockfiles excluded), groups it by directory, and asks
    whether a write-tool deny in the shared .claude/settings.json covers
    each directory. Repositories with no generated files, or no shared
    harness policy at all, are not scored: the practice is harness-specific
    today and its absence says nothing about a repository that uses none.
  `,

  remediation:
    'Add a deny for each generated path family to `permissions.deny` in `.claude/settings.json` (not `settings.local.json`), for example `"Edit(**/__generated__/**)"` and `"Write(**/*.gen.ts)"`. Keep the regeneration command documented so the agent patches the source instead.',

  async detect(ev) {
    const generated = await generatedFiles(ev.size_stats, ev.files);
    if (generated.length === 0) return { kind: "na", reason: "no generated files" };
    const policies = policyFiles(ev.agent_config.harnessConfig);
    if (policies.length === 0) {
      return { kind: "na", reason: "no shared harness permission policy (.claude/settings.json)" };
    }
    const matchers = denyMatchers(policies);

    const families = new Map<string, { total: number; unprotected: number }>();
    for (const path of generated) {
      const dir = dirname(path) || ".";
      const family = families.get(dir) ?? { total: 0, unprotected: 0 };
      family.total++;
      if (!matchers.some((m) => m.test(path))) family.unprotected++;
      families.set(dir, family);
    }

    const items: InventoryItem[] = [];
    for (const [dir, family] of families) {
      if (family.unprotected === 0) continue;
      items.push({
        location: { path: dir },
        severity: "warn",
        message: `${family.unprotected} of ${family.total} generated files editable: no Edit/Write deny covers them`,
      });
    }
    items.sort((a, b) => a.location.path.localeCompare(b.location.path));
    return { kind: "inventory", items };
  },

  score: {
    kind: "inventory",
    severityWeights: { info: 0, warn: 1, error: 1 },
    bands: [{ upTo: 0, score: 100 }, { upTo: 2, score: 50 }, { score: 0 }],
  },

  fixtures: [
    {
      name: "no-generated-files",
      evidence: agentFixture({
        files: {
          "src/index.ts": "export const ok = true;\n",
          ".claude/settings.json": '{ "permissions": { "deny": [] } }\n',
        },
      }),
      expect: { reading: { kind: "na", reason: "no generated files" }, score: null },
    },
    {
      name: "no-shared-policy",
      evidence: agentFixture({
        files: {
          "src/__generated__/schema.ts": "export type Q = {};\n",
          ".claude/settings.local.json":
            '{ "permissions": { "deny": ["Edit(**/__generated__/**)"] } }\n',
        },
      }),
      expect: {
        reading: {
          kind: "na",
          reason: "no shared harness permission policy (.claude/settings.json)",
        },
        score: null,
      },
    },
    {
      name: "deny-covers-every-family",
      evidence: agentFixture({
        files: {
          "src/__generated__/schema.ts": "export type Q = {};\n",
          "src/api/client.gen.ts": "export const client = 1;\n",
          "proto/events.pb.go": "package proto\n",
          "src/routes.ts": "// Code generated by tsr. DO NOT EDIT.\nexport const routes = [];\n",
          ".claude/settings.json": JSON.stringify({
            permissions: {
              deny: [
                "Edit(**/__generated__/**)",
                "Write(**/__generated__/**)",
                "Edit(*.gen.ts)",
                "Edit(/proto/**)",
                "Edit(src/routes.ts)",
                "Bash(rm -rf:*)",
              ],
            },
          }),
        },
      }),
      expect: { reading: { kind: "inventory", items: [] }, score: 100 },
    },
    {
      name: "policy-present-generated-editable",
      evidence: agentFixture({
        files: {
          "src/__generated__/schema.ts": "export type Q = {};\n",
          "src/__generated__/hooks.ts": "export const useQ = 1;\n",
          "proto/events.pb.go": "package proto\n",
          ".claude/settings.json": '{ "permissions": { "deny": ["Bash(rm -rf:*)"] } }\n',
          ".claude/settings.local.json":
            '{ "permissions": { "deny": ["Edit(**/__generated__/**)", "Edit(proto/**)"] } }\n',
        },
      }),
      expect: {
        reading: {
          kind: "inventory",
          items: [
            {
              location: { path: "proto" },
              severity: "warn",
              message: "1 of 1 generated files editable: no Edit/Write deny covers them",
            },
            {
              location: { path: "src/__generated__" },
              severity: "warn",
              message: "2 of 2 generated files editable: no Edit/Write deny covers them",
            },
          ],
        },
        score: 50,
      },
    },
  ],
});
