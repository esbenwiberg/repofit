import { defineProbe } from "@esbenwiberg/repofit/sdk";

export default defineProbe({
  id: "format.clean",
  version: "0.0.0",
  dimensions: [
    { id: "consistency", weight: 1 },
    { id: "feedback", weight: 0.3 },
  ],
  tier: "executed",
  evidence: ["node_package", "commands"],

  rationale: `
    Formatter configured but the codebase doesn't match it is a noisy
    rebase magnet. This invokes the format-check script (or
    \`npm run format -- --check\`) and reports clean only on exit zero.
  `,

  async detect(ev) {
    if (!ev.node_package.present) return { kind: "na", reason: "no package.json" };
    const scripts = ev.node_package.scripts;
    let argv: string[];
    if (typeof scripts["format:check"] === "string" && scripts["format:check"].trim().length > 0) {
      argv = ["npm", "run", "format:check", "--silent"];
    } else if (typeof scripts.format === "string" && scripts.format.trim().length > 0) {
      argv = ["npm", "run", "format", "--silent", "--", "--check"];
    } else {
      return { kind: "na", reason: "no format or format:check script" };
    }
    const run = await ev.commands.run({ argv, timeoutMs: 300_000 });
    if (run.timedOut) return { kind: "na", reason: "format command timed out" };
    return { kind: "predicate", value: run.exitCode === 0 };
  },

  score: { kind: "predicate", direction: "positive" },

  fixtures: [
    {
      name: "no-format-script",
      evidence: { node_package: { present: true, scripts: {} } },
      expect: {
        reading: { kind: "na", reason: "no format or format:check script" },
        score: null,
      },
    },
    {
      name: "format-clean",
      evidence: {
        node_package: { present: true, scripts: { "format:check": "biome check ." } },
        commands: [
          { argv: ["npm", "run", "format:check", "--silent"], exitCode: 0, durationMs: 300 },
        ],
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "format-dirty",
      evidence: {
        node_package: { present: true, scripts: { format: "biome format ." } },
        commands: [
          {
            argv: ["npm", "run", "format", "--silent", "--", "--check"],
            exitCode: 1,
            durationMs: 300,
          },
        ],
      },
      expect: { reading: { kind: "predicate", value: false }, score: 0 },
    },
  ],
});
