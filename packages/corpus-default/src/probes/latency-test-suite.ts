import { defineProbe } from "@esbenwiberg/repofit/sdk";

export default defineProbe({
  id: "latency.test-suite",
  version: "0.0.0",
  dimensions: [{ id: "latency", weight: 1 }],
  tier: "executed",
  evidence: ["node_package", "commands"],

  rationale: `
    Wall-clock of the test suite is the wall-clock of an agent's
    verification cycle. Slow tests turn into a slow agent. Runs the
    suite twice (warm-up + measured) so steady-state is what's
    reported, not first-run compile cost.
  `,

  async detect(ev) {
    if (!ev.node_package.present) return { kind: "na", reason: "no package.json" };
    const script = ev.node_package.scripts.test;
    if (typeof script !== "string" || script.trim().length === 0) {
      return { kind: "na", reason: "no test script" };
    }
    const run = await ev.commands.run({
      argv: ["npm", "test", "--silent"],
      warmup: 1,
      timeoutMs: 300_000,
    });
    if (run.timedOut) return { kind: "na", reason: "test command timed out" };
    if (run.exitCode !== 0) return { kind: "na", reason: `test exited ${run.exitCode}` };
    return { kind: "magnitude", value: run.durationMs, unit: "ms" };
  },

  score: {
    kind: "magnitude",
    direction: "negative",
    bands: [
      { upTo: 10_000, score: 100 },
      { upTo: 30_000, score: 80 },
      { upTo: 120_000, score: 50 },
      { upTo: 300_000, score: 20 },
      { score: 0 },
    ],
  },

  fixtures: [
    {
      name: "no-package-json",
      evidence: { node_package: { present: false } },
      expect: { reading: { kind: "na", reason: "no package.json" }, score: null },
    },
    {
      name: "no-test-script",
      evidence: { node_package: { present: true, scripts: {} } },
      expect: { reading: { kind: "na", reason: "no test script" }, score: null },
    },
    {
      name: "fast-suite",
      evidence: {
        node_package: { present: true, scripts: { test: "vitest run" } },
        commands: [{ argv: ["npm", "test", "--silent"], exitCode: 0, durationMs: 4500 }],
      },
      expect: { reading: { kind: "magnitude", value: 4500, unit: "ms" }, score: 100 },
    },
    {
      name: "medium-suite",
      evidence: {
        node_package: { present: true, scripts: { test: "vitest run" } },
        commands: [{ argv: ["npm", "test", "--silent"], exitCode: 0, durationMs: 60_000 }],
      },
      expect: { reading: { kind: "magnitude", value: 60_000, unit: "ms" }, score: 50 },
    },
    {
      name: "test-fails",
      evidence: {
        node_package: { present: true, scripts: { test: "vitest run" } },
        commands: [{ argv: ["npm", "test", "--silent"], exitCode: 1, durationMs: 1200 }],
      },
      expect: { reading: { kind: "na", reason: "test exited 1" }, score: null },
    },
  ],
});
