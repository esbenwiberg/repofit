#!/usr/bin/env node
import { Command } from "commander";
import { VERSION } from "../index.js";
import { TIERS, type Tier } from "../sdk/types.js";
import { errorMessage } from "../util/error-message.js";
import { apply } from "./apply.js";
import { check, type OutputMode } from "./check.js";
import { explain } from "./explain.js";
import { probeNew } from "./probe-new.js";
import { waiveAdd, waiveLs, waiveRm } from "./waive.js";

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
  .option("--sarif <path>", "Write a SARIF 2.1.0 report to this path (for GitHub code scanning).")
  .option(
    "--comment <path>",
    "Write a markdown PR-comment body to this path (verdict + score + dimension table + top regressions).",
  )
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
      sarif?: string;
      comment?: string;
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
          sarif: opts.sarif,
          comment: opts.comment,
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

const waive = program
  .command("waive")
  .description("Manage waivers — suppress specific findings with a stated reason.");

waive
  .command("add <probeId> <location>")
  .description("Add a waiver. `location` is the file path the probe flagged.")
  .requiredOption("--reason <text>", "Why this finding is waived (required).")
  .option("--expires <date>", "Optional ISO date (YYYY-MM-DD) after which the waiver is invalid.")
  .option("--cwd <path>", "Working directory (must contain repofit.config.json).", process.cwd())
  .action(
    async (
      probeId: string,
      location: string,
      opts: { reason: string; expires?: string; cwd: string },
    ) => {
      try {
        const { stdout, exitCode } = await waiveAdd({
          cwd: opts.cwd,
          probeId,
          location,
          reason: opts.reason,
          expires: opts.expires,
        });
        process.stdout.write(stdout);
        process.exit(exitCode);
      } catch (err) {
        console.error(`repofit: ${errorMessage(err)}`);
        process.exit(2);
      }
    },
  );

waive
  .command("ls")
  .description("List configured waivers with their stable hashes.")
  .option("--cwd <path>", "Working directory (must contain repofit.config.json).", process.cwd())
  .action(async (opts: { cwd: string }) => {
    try {
      const { stdout, exitCode } = await waiveLs({ cwd: opts.cwd });
      process.stdout.write(stdout);
      process.exit(exitCode);
    } catch (err) {
      console.error(`repofit: ${errorMessage(err)}`);
      process.exit(2);
    }
  });

waive
  .command("rm <hash>")
  .description("Remove a waiver by its hash (from `repofit waive ls`).")
  .option("--cwd <path>", "Working directory (must contain repofit.config.json).", process.cwd())
  .action(async (hash: string, opts: { cwd: string }) => {
    try {
      const { stdout, exitCode } = await waiveRm({ cwd: opts.cwd, hash });
      process.stdout.write(stdout);
      process.exit(exitCode);
    } catch (err) {
      console.error(`repofit: ${errorMessage(err)}`);
      process.exit(2);
    }
  });

program
  .command("apply")
  .description("Plan or apply fixes for failing probes. Dry run by default.")
  .option("--probe <id>", "Apply only the fixer for this probe id.")
  .option("--cwd <path>", "Working directory.", process.cwd())
  .option("--write", "Actually write the changes. Without this, only print the plan.")
  .option(
    "--with-llm",
    "Use LLM-mode fixers when available (generate project-specific content via Claude).",
  )
  .option(
    "--llm-transport <mode>",
    "Force LLM transport: 'api' (ANTHROPIC_API_KEY) or 'cli' (claude CLI). Default: auto.",
  )
  .action(
    async (opts: {
      probe?: string;
      cwd: string;
      write?: boolean;
      withLlm?: boolean;
      llmTransport?: string;
    }) => {
      if (
        opts.llmTransport !== undefined &&
        opts.llmTransport !== "api" &&
        opts.llmTransport !== "cli"
      ) {
        console.error(
          `repofit: --llm-transport must be 'api' or 'cli' (got '${opts.llmTransport}')`,
        );
        process.exit(2);
      }
      try {
        const { stdout, exitCode } = await apply({
          cwd: opts.cwd,
          probeId: opts.probe,
          write: opts.write,
          withLlm: opts.withLlm,
          llmTransport: opts.llmTransport as "api" | "cli" | undefined,
        });
        process.stdout.write(stdout);
        process.exit(exitCode);
      } catch (err) {
        console.error(`repofit: ${errorMessage(err)}`);
        process.exit(2);
      }
    },
  );

await program.parseAsync(process.argv);
