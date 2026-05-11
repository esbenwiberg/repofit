import { defineProbe } from "@esbenwiberg/repofit/sdk";

export default defineProbe({
  id: "types.clean",
  version: "0.0.0",
  dimensions: [{ id: "feedback", weight: 1 }],
  tier: "executed",
  evidence: ["node_package", "files", "commands"],

  rationale: `
    Type errors that ship are a clear gate failure. This runs the
    project's typecheck (script or vanilla \`tsc --noEmit\`) and
    reports clean only on exit zero. N/A on repos without TS
    configuration.
  `,

  async detect(ev) {
    if (!ev.node_package.present && !ev.files.has("tsconfig.json")) {
      return { kind: "na", reason: "no TS configuration" };
    }
    const scripted =
      ev.node_package.present &&
      typeof ev.node_package.scripts.typecheck === "string" &&
      ev.node_package.scripts.typecheck.trim().length > 0;

    let argv: string[];
    if (scripted) {
      argv = ["npm", "run", "typecheck", "--silent"];
    } else if (ev.files.has("tsconfig.json")) {
      argv = ["npx", "--no-install", "tsc", "--noEmit"];
    } else {
      return { kind: "na", reason: "no typecheck script and no tsconfig.json" };
    }

    const run = await ev.commands.run({ argv, timeoutMs: 300_000 });
    if (run.timedOut) return { kind: "na", reason: "typecheck timed out" };
    return { kind: "predicate", value: run.exitCode === 0 };
  },

  score: { kind: "predicate", direction: "positive" },

  fixtures: [
    {
      name: "no-ts-config",
      evidence: { node_package: { present: true, scripts: {} } },
      expect: {
        reading: { kind: "na", reason: "no typecheck script and no tsconfig.json" },
        score: null,
      },
    },
    {
      name: "types-clean",
      evidence: {
        node_package: { present: true, scripts: { typecheck: "tsc --noEmit" } },
        commands: [
          { argv: ["npm", "run", "typecheck", "--silent"], exitCode: 0, durationMs: 4500 },
        ],
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "types-dirty",
      evidence: {
        node_package: { present: true, scripts: { typecheck: "tsc --noEmit" } },
        commands: [
          { argv: ["npm", "run", "typecheck", "--silent"], exitCode: 1, durationMs: 4500 },
        ],
      },
      expect: { reading: { kind: "predicate", value: false }, score: 0 },
    },
  ],
});
