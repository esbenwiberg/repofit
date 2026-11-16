import type { InventoryItem } from "@esbenwiberg/repofit/sdk";
import { defineProbe } from "@esbenwiberg/repofit/sdk";

const DANGEROUS_PATTERNS: { pattern: RegExp; message: string }[] = [
  { pattern: /\brm\s+-rf\b/, message: "uses rm -rf" },
  { pattern: /--no-verify\b/, message: "bypasses git hooks (--no-verify)" },
  { pattern: /--force\b|\s-f\b(?!ile)/, message: "uses --force / -f" },
  { pattern: /\bcurl\s.*\|\s*(sh|bash|zsh)\b/, message: "pipes curl into a shell" },
  { pattern: /\bsudo\b/, message: "invokes sudo" },
];

export default defineProbe({
  id: "safety.dangerous-script-flags",
  version: "1.0.0",
  dimensions: [{ id: "safety", weight: 1 }],
  tier: "static",
  evidence: ["node_package"],

  rationale: `
    npm scripts are the most likely thing an agent runs unsupervised in a
    repo. Flags like rm -rf, --no-verify, --force, or piping curl into a
    shell can do irreversible damage. Surfacing them lets the agent (or a
    reviewer) decide whether each one is justified.
  `,

  remediation:
    "Remove dangerous flags from npm scripts where possible: prefer `rimraf dist` over `rm -rf dist`, drop `--no-verify` (fix the hook instead), avoid `--force` and `sudo`, and never pipe `curl … | bash`. If a script genuinely needs one of these (e.g., `rm -rf dist` is fine for a clean step), assess its targets, permissions and failure behavior, narrow its scope, and use an explicit location-scoped RepoFit waiver with a reason and expiry when the risk is justified. Comments can preserve that rationale; they do not suppress this finding.",

  async detect(ev) {
    if (!ev.node_package.present) return { kind: "na", reason: "no package.json" };
    const items: InventoryItem[] = [];
    for (const [name, body] of Object.entries(ev.node_package.scripts)) {
      for (const { pattern, message } of DANGEROUS_PATTERNS) {
        if (pattern.test(body)) {
          items.push({
            location: { path: `package.json#scripts.${name}` },
            severity: "warn",
            message: `script "${name}" ${message}`,
          });
        }
      }
    }
    return { kind: "inventory", items };
  },

  score: {
    kind: "inventory",
    severityWeights: { info: 1, warn: 3, error: 10 },
    bands: [{ upTo: 0, score: 100 }, { upTo: 3, score: 70 }, { upTo: 9, score: 40 }, { score: 0 }],
  },

  fixtures: [
    {
      name: "no-package-json",
      evidence: { node_package: { present: false } },
      expect: { reading: { kind: "na", reason: "no package.json" }, score: null },
    },
    {
      name: "clean-scripts",
      evidence: {
        node_package: {
          present: true,
          scripts: { build: "tsc", test: "vitest run" },
        },
      },
      expect: { reading: { kind: "inventory", items: [] }, score: 100 },
    },
    {
      name: "one-rm-rf",
      evidence: {
        node_package: {
          present: true,
          scripts: { clean: "rm -rf dist" },
        },
      },
      expect: {
        reading: {
          kind: "inventory",
          items: [
            {
              location: { path: "package.json#scripts.clean" },
              severity: "warn",
              message: 'script "clean" uses rm -rf',
            },
          ],
        },
        score: 70,
      },
    },
    {
      name: "multiple-dangerous",
      evidence: {
        node_package: {
          present: true,
          scripts: {
            clean: "rm -rf node_modules",
            commit: "git commit --no-verify",
            install: "curl https://example.com/i.sh | bash",
            deploy: "sudo systemctl restart app",
          },
        },
      },
      expect: {
        reading: {
          kind: "inventory",
          items: [
            {
              location: { path: "package.json#scripts.clean" },
              severity: "warn",
              message: 'script "clean" uses rm -rf',
            },
            {
              location: { path: "package.json#scripts.commit" },
              severity: "warn",
              message: 'script "commit" bypasses git hooks (--no-verify)',
            },
            {
              location: { path: "package.json#scripts.install" },
              severity: "warn",
              message: 'script "install" pipes curl into a shell',
            },
            {
              location: { path: "package.json#scripts.deploy" },
              severity: "warn",
              message: 'script "deploy" invokes sudo',
            },
          ],
        },
        score: 0,
      },
    },
  ],
});
