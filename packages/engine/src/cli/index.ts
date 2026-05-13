#!/usr/bin/env node
import { Command } from "commander";
import { VERSION } from "../index.js";
import { TIERS, type Tier } from "../sdk/types.js";
import { errorMessage } from "../util/error-message.js";
import { check, type OutputMode } from "./check.js";
import { explain } from "./explain.js";
import { probeNew } from "./probe-new.js";

const VALID_TIERS = new Set<Tier>(TIERS);

function parseInclude(value: string, previous: Tier[] = []): Tier[] {
  const tokens = value
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  for (const t of tokens) {
    if (!VALID_TIERS.has(t as Tier)) {
      throw new Error(`--include: unknown tier '${t}' (valid: ${TIERS.join(", ")})`);
    }
  }
  return [...previous, ...(tokens as Tier[])];
}

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
  .option("--html <path>", "Write a self-contained HTML report to this path.")
  .option(
    "--include <tier>",
    "Opt-in tier (executed, reasoned). Comma-separate or repeat to add multiple.",
    parseInclude,
    [] as Tier[],
  )
  .option("--no-cache", "Skip the persistent judge cache for reasoned-tier probes.")
  .option(
    "--judge-transport <mode>",
    "Force judge transport: 'api' (ANTHROPIC_API_KEY) or 'cli' (claude CLI). Default: auto.",
  )
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
      html?: string;
      include: Tier[];
      cache: boolean;
      judgeTransport?: string;
    }) => {
      if (opts.json && opts.ci) {
        console.error("repofit: --json and --ci are mutually exclusive.");
        process.exit(2);
      }
      if (
        opts.judgeTransport !== undefined &&
        opts.judgeTransport !== "api" &&
        opts.judgeTransport !== "cli"
      ) {
        console.error(
          `repofit: --judge-transport must be 'api' or 'cli' (got '${opts.judgeTransport}')`,
        );
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
          html: opts.html,
          include: opts.include,
          noCache: opts.cache === false,
          judgeTransport: opts.judgeTransport as "api" | "cli" | undefined,
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
  .option(
    "--run",
    "Also run the probe against the current repo and show the reading + score derivation.",
  )
  .option("--cwd <path>", "Working directory (only with --run).", process.cwd())
  .option("--no-cache", "Skip the persistent judge cache (only with --run, for reasoned probes).")
  .option(
    "--judge-transport <mode>",
    "Force judge transport: 'api' or 'cli' (only with --run, for reasoned probes).",
  )
  .action(
    async (
      id: string,
      opts: { run?: boolean; cwd: string; cache: boolean; judgeTransport?: string },
    ) => {
      if (
        opts.judgeTransport !== undefined &&
        opts.judgeTransport !== "api" &&
        opts.judgeTransport !== "cli"
      ) {
        console.error(
          `repofit: --judge-transport must be 'api' or 'cli' (got '${opts.judgeTransport}')`,
        );
        process.exit(2);
      }
      try {
        const { stdout, exitCode } = await explain({
          id,
          run: opts.run,
          cwd: opts.cwd,
          noCache: opts.cache === false,
          judgeTransport: opts.judgeTransport as "api" | "cli" | undefined,
        });
        process.stdout.write(stdout);
        process.exit(exitCode);
      } catch (err) {
        console.error(`repofit: ${errorMessage(err)}`);
        process.exit(2);
      }
    },
  );

const probe = program.command("probe").description("Author probes for a custom corpus.");

probe
  .command("new <id>")
  .description("Scaffold a new probe file (id format: 'category.what-it-checks').")
  .option("--kind <kind>", "Reading kind: predicate (default), count, or magnitude.", "predicate")
  .option("--dir <path>", "Directory to write the scaffold into. Defaults to ./probes.")
  .action(async (id: string, opts: { kind?: string; dir?: string }) => {
    try {
      const { stdout, exitCode } = await probeNew({ id, kind: opts.kind, dir: opts.dir });
      process.stdout.write(stdout);
      process.exit(exitCode);
    } catch (err) {
      console.error(`repofit: ${errorMessage(err)}`);
      process.exit(2);
    }
  });

await program.parseAsync(process.argv);
