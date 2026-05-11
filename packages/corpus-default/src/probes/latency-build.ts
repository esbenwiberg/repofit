import { defineProbe } from "@esbenwiberg/repofit/sdk";

export default defineProbe({
  id: "latency.build",
  version: "0.0.0",
  dimensions: [{ id: "latency", weight: 1 }],
  tier: "executed",
  evidence: ["node_package", "commands"],

  rationale: `
    Build wall-clock gates how often an agent can verify integration
    locally. Bands match the test-suite probe: <10s great, >300s
    actively painful.
  `,

  async detect(ev) {
    if (!ev.node_package.present) return { kind: "na", reason: "no package.json" };
    const script = ev.node_package.scripts.build;
    if (typeof script !== "string" || script.trim().length === 0) {
      return { kind: "na", reason: "no build script" };
    }
    const run = await ev.commands.run({
      argv: ["npm", "run", "build", "--silent"],
      warmup: 1,
      timeoutMs: 300_000,
    });
    if (run.timedOut) return { kind: "na", reason: "build command timed out" };
    if (run.exitCode !== 0) return { kind: "na", reason: `build exited ${run.exitCode}` };
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
      name: "no-build-script",
      evidence: { node_package: { present: true, scripts: {} } },
      expect: { reading: { kind: "na", reason: "no build script" }, score: null },
    },
    {
      name: "fast-build",
      evidence: {
        node_package: { present: true, scripts: { build: "tsc" } },
        commands: [{ argv: ["npm", "run", "build", "--silent"], exitCode: 0, durationMs: 3200 }],
      },
      expect: { reading: { kind: "magnitude", value: 3200, unit: "ms" }, score: 100 },
    },
  ],
});
