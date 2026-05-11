import { defineProbe } from "@esbenwiberg/repofit/sdk";

export default defineProbe({
  id: "latency.lint",
  version: "0.0.0",
  dimensions: [{ id: "latency", weight: 1 }],
  tier: "executed",
  evidence: ["node_package", "commands"],

  rationale: `
    Lint should be the cheapest gate — agents rerun it many times per
    task. A slow linter pushes them to skip the loop. Bands match the
    rest of the executed-latency family.
  `,

  async detect(ev) {
    if (!ev.node_package.present) return { kind: "na", reason: "no package.json" };
    const script = ev.node_package.scripts.lint;
    if (typeof script !== "string" || script.trim().length === 0) {
      return { kind: "na", reason: "no lint script" };
    }
    const run = await ev.commands.run({
      argv: ["npm", "run", "lint", "--silent"],
      warmup: 1,
      timeoutMs: 300_000,
    });
    if (run.timedOut) return { kind: "na", reason: "lint command timed out" };
    if (run.exitCode !== 0) return { kind: "na", reason: `lint exited ${run.exitCode}` };
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
      name: "no-lint-script",
      evidence: { node_package: { present: true, scripts: {} } },
      expect: { reading: { kind: "na", reason: "no lint script" }, score: null },
    },
    {
      name: "fast-lint",
      evidence: {
        node_package: { present: true, scripts: { lint: "biome check ." } },
        commands: [{ argv: ["npm", "run", "lint", "--silent"], exitCode: 0, durationMs: 800 }],
      },
      expect: { reading: { kind: "magnitude", value: 800, unit: "ms" }, score: 100 },
    },
  ],
});
