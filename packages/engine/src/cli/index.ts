#!/usr/bin/env node
import { Command } from "commander";
import { VERSION } from "../index.js";
import { errorMessage } from "../util/error-message.js";
import { check, type OutputMode } from "./check.js";
import { explain } from "./explain.js";

const program = new Command();

program
  .name("repofit")
  .description("Measure how agent-friendly your repo is.")
  .version(`repofit ${VERSION}`, "-v, --version");

program
  .command("check", { isDefault: true })
  .description("Run probes against the repo and emit a fitness score.")
  .option("--probe <id>", "Run a single probe by id (debugging the corpus).")
  .option("--cwd <path>", "Working directory.", process.cwd())
  .option("--init", "Write a starter repofit.config.json and exit.")
  .option("--accept", "Run probes and write repofit-baseline.json with the current scores.")
  .option("--dirty", "Allow --accept with a dirty git working tree.")
  .option("--json", "Emit the full report as JSON to stdout.")
  .option("--ci", "Emit a CI-friendly verdict line; respects GITHUB_ACTIONS env.")
  .option("--artifact <path>", "With --ci, also write the JSON report to this path.")
  .action(
    async (opts: {
      probe?: string;
      cwd: string;
      init?: boolean;
      accept?: boolean;
      dirty?: boolean;
      json?: boolean;
      ci?: boolean;
      artifact?: string;
    }) => {
      if (opts.json && opts.ci) {
        console.error("repofit: --json and --ci are mutually exclusive.");
        process.exit(2);
      }
      let output: OutputMode = "human";
      if (opts.json) output = "json";
      else if (opts.ci) output = "ci";
      try {
        const exitCode = await check({
          cwd: opts.cwd,
          probe: opts.probe,
          init: opts.init,
          accept: opts.accept,
          dirty: opts.dirty,
          output,
          artifact: opts.artifact,
        });
        process.exit(exitCode);
      } catch (err) {
        console.error(`repofit: ${errorMessage(err)}`);
        process.exit(2);
      }
    },
  );

program
  .command("explain <id>")
  .description("Show the rationale, scoring, and fixtures for a probe or dimension.")
  .action(async (id: string) => {
    try {
      const { stdout, exitCode } = await explain({ id });
      process.stdout.write(stdout);
      process.exit(exitCode);
    } catch (err) {
      console.error(`repofit: ${errorMessage(err)}`);
      process.exit(2);
    }
  });

await program.parseAsync(process.argv);
