#!/usr/bin/env node
import { runList } from "./commands/list.js";
import { runDoctor } from "./commands/doctor.js";
import { runAdd } from "./commands/add.js";
import { runUpgrade } from "./commands/upgrade.js";
import { runRemove } from "./commands/remove.js";
import { runCoach, type CoachKind } from "./commands/coach.js";

const VERSION = "0.0.0";

const HELP = `agentry ${VERSION}

Form your agentic readiness.

Usage:
  agentry list                       List catalog entries
  agentry doctor [path]              Audit a repo's agent-readiness (default: cwd)
  agentry add <id> [path]            Install a catalog entry into a repo
  agentry upgrade [id] [path]        Refresh installed entries from the catalog
  agentry remove <id> [path]         Uninstall an entry and prune the lockfile
  agentry coach <kind> [args] [path] Author un-installable scaffolding

Coach kinds:
  agentry coach claude-md [--nested <subdir>]
  agentry coach practices
  agentry coach adr-init             Bootstrap docs/adr/ (template + README + ADR-0)
  agentry coach adr <slug>           Auto-numbered new ADR

Flags (list):
  --show-deprecated                  Include deprecated entries

Flags (add):
  --no-claude                        Skip files with flavor=claude
  --no-recipe                        Skip files with flavor=agnostic
  --no-deps                          Skip auto-install of requires.entries
  --non-interactive                  Don't prompt; pick the safe default per
                                     prompt (install deps, keep existing files)
  --dry-run                          Show what would happen, don't write

Flags (upgrade):
  --force                            Overwrite user-edited files
  --non-interactive                  Don't prompt; auto-accept the plan
  --dry-run                          Show the plan, don't write

Flags (remove):
  --force                            Also delete user-edited files
  --non-interactive                  Don't prompt; auto-accept removal
  --dry-run                          Show the plan, don't delete

Flags (coach):
  --nested <subdir>                  (claude-md) write nested CLAUDE.md
  --name <project-name>              Override project name (default: cwd basename)
  --title <title>                    (adr) ADR title (skip prompt)
  --non-interactive                  No prompts; use defaults
  --dry-run                          Show what would happen, don't write

  agentry --help                     Show this message
  agentry --version                  Show version

Status: Phase 2.6 — list, doctor, add, upgrade, remove, coach implemented.
See https://github.com/esbenwiberg/agentry`;

const VALUE_FLAGS = new Set(["--nested", "--title", "--name"]);

interface ParsedArgs {
  verb: string | undefined;
  positional: string[];
  flags: Map<string, string>;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  let i = 0;
  while (i < argv.length) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        flags.set(a.slice(0, eq), a.slice(eq + 1));
        i++;
        continue;
      }
      if (VALUE_FLAGS.has(a) && i + 1 < argv.length) {
        flags.set(a, argv[i + 1]!);
        i += 2;
        continue;
      }
      flags.set(a, "");
      i++;
      continue;
    }
    positional.push(a);
    i++;
  }
  const [verb, ...rest] = positional;
  return { verb, positional: rest, flags };
}

const COACH_KINDS = new Set<CoachKind>([
  "claude-md",
  "practices",
  "adr-init",
  "adr",
]);

async function main(argv: readonly string[]): Promise<number> {
  const args = argv.slice(2);
  const { verb, positional, flags } = parseArgs(args);

  if (!verb || flags.has("--help") || verb === "--help" || verb === "-h") {
    console.log(HELP);
    return 0;
  }
  if (flags.has("--version") || verb === "--version" || verb === "-v") {
    console.log(VERSION);
    return 0;
  }

  switch (verb) {
    case "list":
      return runList({ showDeprecated: flags.has("--show-deprecated") });
    case "doctor": {
      const cwd = positional[0] ?? process.cwd();
      return runDoctor({ cwd });
    }
    case "add": {
      const id = positional[0];
      if (!id) {
        console.error(`agentry add: missing entry id`);
        console.error(`Usage: agentry add <id> [path]`);
        return 1;
      }
      const cwd = positional[1] ?? process.cwd();
      return runAdd({
        cwd,
        id,
        noClaude: flags.has("--no-claude"),
        noRecipe: flags.has("--no-recipe"),
        noDeps: flags.has("--no-deps"),
        nonInteractive: flags.has("--non-interactive"),
        dryRun: flags.has("--dry-run"),
      });
    }
    case "remove": {
      const id = positional[0];
      if (!id) {
        console.error(`agentry remove: missing entry id`);
        console.error(`Usage: agentry remove <id> [path]`);
        return 1;
      }
      const cwd = positional[1] ?? process.cwd();
      return runRemove({
        cwd,
        id,
        dryRun: flags.has("--dry-run"),
        force: flags.has("--force"),
        nonInteractive: flags.has("--non-interactive"),
      });
    }
    case "upgrade": {
      // Disambiguate `agentry upgrade <id>` from `agentry upgrade <path>` by
      // matching the catalog id grammar — anything else is treated as cwd.
      const first = positional[0];
      const isId = first !== undefined && /^[a-z][a-z0-9-]*$/.test(first);
      const id = isId ? first : undefined;
      const cwd = isId
        ? (positional[1] ?? process.cwd())
        : (first ?? process.cwd());
      return runUpgrade({
        cwd,
        id,
        dryRun: flags.has("--dry-run"),
        force: flags.has("--force"),
        nonInteractive: flags.has("--non-interactive"),
      });
    }
    case "coach": {
      const kind = positional[0];
      if (!kind || !COACH_KINDS.has(kind as CoachKind)) {
        console.error(
          `agentry coach: unknown kind '${kind ?? ""}'. Expected one of: ${[...COACH_KINDS].join(", ")}`,
        );
        return 1;
      }
      const rest = positional.slice(1);
      let subPositional: string[];
      let cwd: string;
      if (kind === "adr") {
        // coach adr <slug> [path]
        subPositional = rest.length > 0 ? [rest[0]!] : [];
        cwd = rest[1] ?? process.cwd();
      } else {
        // coach <kind> [path]
        subPositional = [];
        cwd = rest[0] ?? process.cwd();
      }
      return runCoach({
        cwd,
        kind: kind as CoachKind,
        positional: subPositional,
        ...(flags.get("--nested") ? { nested: flags.get("--nested")! } : {}),
        ...(flags.get("--title") ? { title: flags.get("--title")! } : {}),
        ...(flags.get("--name") ? { name: flags.get("--name")! } : {}),
        nonInteractive: flags.has("--non-interactive"),
        dryRun: flags.has("--dry-run"),
      });
    }
    default:
      console.error(`agentry: unknown command '${verb}'.`);
      console.error(`Try 'agentry --help'.`);
      return 1;
  }
}

main(process.argv).then(
  (code) => process.exit(code),
  (err) => {
    console.error(`agentry: unexpected error: ${(err as Error).message}`);
    process.exit(2);
  },
);
