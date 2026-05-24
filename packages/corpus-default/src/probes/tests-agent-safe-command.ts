import type { InventoryItem } from "@esbenwiberg/repofit/sdk";
import { defineProbe } from "@esbenwiberg/repofit/sdk";

const AGENT_SAFE_TEST_SCRIPTS = ["test:agent", "test:unit", "test:smoke", "test:fast"] as const;
const E2E_TEST_HINT = /\b(playwright|cypress|testcafe|webdriver|selenium|detox|e2e)\b/i;

export default defineProbe({
  id: "tests.agent-safe-command",
  version: "2.0.0",
  dimensions: [
    { id: "feedback", weight: 1 },
    { id: "latency", weight: 0.5 },
  ],
  tier: "static",
  evidence: ["node_package", "toolchain"],

  rationale: `
    Executed probes should not surprise a repo by running hundreds of browser
    tests. Repofit resolves one test command for the primary stack (Node,
    Python, .NET, or Go). For Node projects it prefers fast agent-safe scripts
    (test:agent, test:unit, test:smoke, test:fast) before npm test. If the
    resolved command looks e2e-heavy, this probe asks the repo to expose a
    smaller verification command or configure toolchain.commands.test.
  `,

  remediation:
    "Expose a fast verification command for the primary stack. Node: add `test:agent`, `test:unit`, `test:smoke`, or `test:fast`, and keep full browser/e2e suites under `test:e2e` or an explicit CI-only command. Python/.NET/Go: keep the default test command focused on the fast suite, or set `toolchain.commands.test` in `repofit.config.json` to the exact command repofit should run in executed mode.",

  async detect(ev) {
    if (!ev.toolchain.primary) return { kind: "na", reason: "no supported primary stack" };

    const items: InventoryItem[] = [];
    const resolvedTest = ev.toolchain.commands.test;

    if (!resolvedTest) {
      items.push({
        location: { path: "repofit.config.json#toolchain.commands.test" },
        severity: "warn",
        message: "no fast test command resolved for the primary stack",
      });
      return { kind: "inventory", items };
    }

    if (ev.toolchain.primary === "node") {
      const scripts = ev.node_package.scripts ?? {};
      const hasSafe = AGENT_SAFE_TEST_SCRIPTS.some((script) => hasScript(scripts, script));
      const test = scripts.test ?? "";

      if (!hasSafe && E2E_TEST_HINT.test(test)) {
        items.push({
          location: { path: "package.json#scripts.test" },
          severity: "warn",
          message:
            "npm test looks e2e-heavy; add test:agent/test:unit/test:smoke or configure toolchain.commands.test",
        });
      }
    }

    const argvText = resolvedTest.argv.join(" ");
    if (resolvedTest.source !== "node" && E2E_TEST_HINT.test(argvText)) {
      items.push({
        location: { path: "repofit.config.json#toolchain.commands.test" },
        severity: "warn",
        message:
          "resolved test command looks e2e-heavy; configure toolchain.commands.test with a faster suite",
      });
    }

    return { kind: "inventory", items };
  },

  score: {
    kind: "inventory",
    severityWeights: { info: 1, warn: 3, error: 10 },
    bands: [{ upTo: 0, score: 100 }, { upTo: 3, score: 70 }, { score: 0 }],
  },

  fixtures: [
    {
      name: "no-supported-stack",
      evidence: { toolchain: { primary: null } },
      expect: { reading: { kind: "na", reason: "no supported primary stack" }, score: null },
    },
    {
      name: "python-pytest-is-safe",
      evidence: {
        toolchain: {
          stacks: ["python"],
          primary: "python",
          commands: { test: { source: "python", argv: ["pytest"] } },
        },
      },
      expect: { reading: { kind: "inventory", items: [] }, score: 100 },
    },
    {
      name: "primary-stack-without-test-command",
      evidence: {
        toolchain: {
          stacks: ["python"],
          primary: "python",
          commands: { test: null },
        },
      },
      expect: {
        reading: {
          kind: "inventory",
          items: [
            {
              location: { path: "repofit.config.json#toolchain.commands.test" },
              severity: "warn",
              message: "no fast test command resolved for the primary stack",
            },
          ],
        },
        score: 70,
      },
    },
    {
      name: "safe-test-script-present",
      evidence: {
        toolchain: {
          stacks: ["node"],
          primary: "node",
          commands: { test: { source: "node", argv: ["npm", "run", "test:agent", "--silent"] } },
        },
        node_package: {
          present: true,
          scripts: { test: "playwright test", "test:agent": "vitest run" },
        },
      },
      expect: { reading: { kind: "inventory", items: [] }, score: 100 },
    },
    {
      name: "normal-npm-test",
      evidence: {
        toolchain: {
          stacks: ["node"],
          primary: "node",
          commands: { test: { source: "node", argv: ["npm", "test", "--silent"] } },
        },
        node_package: { present: true, scripts: { test: "vitest run" } },
      },
      expect: { reading: { kind: "inventory", items: [] }, score: 100 },
    },
    {
      name: "e2e-only-npm-test",
      evidence: {
        toolchain: {
          stacks: ["node"],
          primary: "node",
          commands: { test: { source: "node", argv: ["npm", "test", "--silent"] } },
        },
        node_package: { present: true, scripts: { test: "playwright test" } },
      },
      expect: {
        reading: {
          kind: "inventory",
          items: [
            {
              location: { path: "package.json#scripts.test" },
              severity: "warn",
              message:
                "npm test looks e2e-heavy; add test:agent/test:unit/test:smoke or configure toolchain.commands.test",
            },
          ],
        },
        score: 70,
      },
    },
  ],
});

function hasScript(scripts: Record<string, string>, name: string): boolean {
  return typeof scripts[name] === "string" && scripts[name].trim().length > 0;
}
