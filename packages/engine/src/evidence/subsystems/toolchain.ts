import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  DotnetProjectEvidence,
  GatherContext,
  GoModuleEvidence,
  NodePackageEvidence,
  PythonProjectEvidence,
  ToolchainCommand,
  ToolchainContext,
  ToolchainEvidence,
  ToolchainPhase,
  ToolchainStack,
} from "../../sdk/types.js";
import { dotnetProjectSubsystem } from "./dotnet-project.js";
import { goModuleSubsystem } from "./go-module.js";
import { nodePackageSubsystem } from "./node-package.js";
import { pythonProjectSubsystem } from "./python-project.js";

/**
 * Tie-breaker when multiple manifests are present and the detected stacks have
 * equal runnable command coverage.
 */
const STACK_PRECEDENCE: ToolchainStack[] = ["node", "python", "dotnet", "go"];

const PHASES: ToolchainPhase[] = ["build", "test", "lint", "typecheck", "format"];

const AGENT_SAFE_TEST_SCRIPTS = ["test:agent", "test:unit", "test:smoke", "test:fast"] as const;
const E2E_TEST_HINT = /\b(playwright|cypress|testcafe|webdriver|selenium|detox|e2e)\b/i;

export const toolchainSubsystem = {
  async gather(ctx: GatherContext): Promise<ToolchainEvidence> {
    const [node, python, dotnet, go] = await Promise.all([
      nodePackageSubsystem.gather(ctx),
      pythonProjectSubsystem.gather(ctx),
      dotnetProjectSubsystem.gather(ctx),
      goModuleSubsystem.gather(ctx),
    ]);
    return resolve(ctx, { node, python, dotnet, go });
  },
};

export type ToolchainInputs = {
  node: NodePackageEvidence;
  python: PythonProjectEvidence;
  dotnet: DotnetProjectEvidence;
  go: GoModuleEvidence;
};

/**
 * Exported for testing. Given the four stack-evidence snapshots and a
 * gather context, produces the resolved toolchain evidence (stacks,
 * primary, per-phase commands).
 */
export function resolve(ctx: GatherContext, inputs: ToolchainInputs): ToolchainEvidence {
  const detectedStacks = detectStacks(inputs);
  const tcCtx: ToolchainContext = ctx.toolchain ?? {};
  const primary = pickPrimary(detectedStacks, tcCtx.primaryStack, inputs, ctx);
  const stacks = primary
    ? [primary, ...detectedStacks.filter((stack) => stack !== primary)]
    : detectedStacks;
  const commands: ToolchainEvidence["commands"] = {
    build: null,
    test: null,
    lint: null,
    typecheck: null,
    format: null,
  };
  for (const phase of PHASES) {
    commands[phase] = resolvePhase(phase, primary, inputs, ctx, tcCtx);
  }
  return { stacks, primary, commands };
}

function detectStacks(inputs: ToolchainInputs): ToolchainStack[] {
  const out: ToolchainStack[] = [];
  if (inputs.node.present) out.push("node");
  if (inputs.python.present) out.push("python");
  if (inputs.dotnet.present) out.push("dotnet");
  if (inputs.go.present) out.push("go");
  out.sort((a, b) => STACK_PRECEDENCE.indexOf(a) - STACK_PRECEDENCE.indexOf(b));
  return out;
}

function pickPrimary(
  stacks: ToolchainStack[],
  override: ToolchainStack | undefined,
  inputs: ToolchainInputs,
  ctx: GatherContext,
): ToolchainStack | null {
  if (override && stacks.includes(override)) return override;
  let best: ToolchainStack | null = null;
  let bestScore = -1;
  for (const stack of stacks) {
    const score = commandCoverage(stack, inputs, ctx);
    if (score > bestScore) {
      best = stack;
      bestScore = score;
    }
  }
  return best;
}

function commandCoverage(
  stack: ToolchainStack,
  inputs: ToolchainInputs,
  ctx: GatherContext,
): number {
  return PHASES.filter((phase) => defaultArgvFor(phase, stack, inputs, ctx) !== null).length;
}

function resolvePhase(
  phase: ToolchainPhase,
  primary: ToolchainStack | null,
  inputs: ToolchainInputs,
  ctx: GatherContext,
  tcCtx: ToolchainContext,
): ToolchainCommand | null {
  const override = tcCtx.commands?.[phase];
  if (override && override.length > 0) {
    return { source: "explicit", argv: override };
  }
  if (!primary) return null;
  const argv = defaultArgvFor(phase, primary, inputs, ctx);
  return argv ? { source: primary, argv } : null;
}

function defaultArgvFor(
  phase: ToolchainPhase,
  stack: ToolchainStack,
  inputs: ToolchainInputs,
  ctx: GatherContext,
): string[] | null {
  switch (stack) {
    case "node":
      return nodeArgv(phase, inputs.node, ctx.cwd);
    case "python":
      return pythonArgv(phase, inputs.python);
    case "dotnet":
      return dotnetArgv(phase);
    case "go":
      return goArgv(phase, ctx.cwd);
  }
}

function nodeArgv(phase: ToolchainPhase, node: NodePackageEvidence, cwd: string): string[] | null {
  // Node has no real ecosystem convention outside package.json scripts.
  // We only run a script if the user has actually declared it.
  if (!node.present) return null;
  const hasScript = (name: string) =>
    typeof node.scripts[name] === "string" && node.scripts[name].trim().length > 0;

  if (phase === "build") return hasScript("build") ? ["npm", "run", "build", "--silent"] : null;
  if (phase === "test") {
    for (const script of AGENT_SAFE_TEST_SCRIPTS) {
      if (hasScript(script)) return ["npm", "run", script, "--silent"];
    }
    if (!hasScript("test")) return null;
    // Avoid surprising users by running a full browser/e2e suite in executed mode.
    // They can still opt into that explicitly with toolchain.commands.test.
    if (E2E_TEST_HINT.test(node.scripts.test ?? "")) return null;
    return ["npm", "test", "--silent"];
  }
  if (phase === "lint") return hasScript("lint") ? ["npm", "run", "lint", "--silent"] : null;
  if (phase === "format") {
    if (hasScript("format:check")) return ["npm", "run", "format:check", "--silent"];
    if (hasScript("format")) return ["npm", "run", "format", "--silent"];
    return null;
  }
  if (phase === "typecheck") {
    if (hasScript("typecheck")) return ["npm", "run", "typecheck", "--silent"];
    if (existsSync(join(cwd, "tsconfig.json"))) return ["npx", "tsc", "--noEmit"];
    return null;
  }
  return null;
}

function pythonArgv(phase: ToolchainPhase, python: PythonProjectEvidence): string[] | null {
  const tools = python.pyproject?.tools ?? [];
  const toolHints = python.pyproject?.toolHints ?? [];
  const requirementHints = python.requirementsToolHints ?? [];
  const configFiles = python.configFiles ?? [];
  const hasTool = (name: string) =>
    tools.includes(name) || toolHints.includes(name) || requirementHints.includes(name);
  const hasConfig = (pattern: RegExp) => configFiles.some((path) => pattern.test(path));

  if (phase === "build") {
    return python.pyproject?.hasBuildSystem ? ["python", "-m", "build"] : null;
  }
  if (phase === "test") {
    if (hasTool("tox") || hasConfig(/(?:^|\/)tox\.ini$/i)) return ["tox"];
    if (
      hasTool("pytest") ||
      hasConfig(/(?:^|\/)(?:pytest\.ini|conftest\.py)$/i) ||
      hasConfig(/(?:^|\/)pyproject\.toml$/i)
    ) {
      return ["pytest"];
    }
    // Be conservative — only suggest pytest if it is actually configured.
    return null;
  }
  if (phase === "lint") {
    const hasRuff = hasTool("ruff");
    const hasFlake8 = hasTool("flake8");
    const hasPylint = hasTool("pylint");
    const hasRuffConfig = hasConfig(/(?:^|\/)(?:ruff\.toml|\.ruff\.toml)$/i);
    const hasFlake8Config = hasConfig(/(?:^|\/)\.flake8$/i);
    const hasPylintConfig = hasConfig(/(?:^|\/)(?:\.pylintrc|pylintrc)$/i);
    // Multiple linters configured → ambiguous, defer to explicit config.
    const ruff = hasRuff || hasRuffConfig;
    const flake8 = hasFlake8 || hasFlake8Config;
    const pylint = hasPylint || hasPylintConfig;
    const count = [ruff, flake8, pylint].filter(Boolean).length;
    if (count > 1) return null;
    if (ruff) return ["ruff", "check", "."];
    if (flake8) return ["flake8", "."];
    if (pylint) return ["pylint", "."];
    return null;
  }
  if (phase === "format") {
    if (hasTool("ruff") || hasConfig(/(?:^|\/)(?:ruff\.toml|\.ruff\.toml)$/i)) {
      return ["ruff", "format", "--check", "."];
    }
    if (hasTool("black")) return ["black", "--check", "."];
    if (hasTool("autopep8")) return ["autopep8", "--check", "--recursive", "."];
    if (hasTool("yapf")) return ["yapf", "--diff", "--recursive", "."];
    if (hasTool("isort")) return ["isort", "--check-only", "."];
    return null;
  }
  if (phase === "typecheck") {
    if (hasTool("mypy") || hasConfig(/(?:^|\/)(?:mypy\.ini|\.mypy\.ini)$/i)) return ["mypy", "."];
    if (hasTool("pyright") || hasConfig(/(?:^|\/)pyrightconfig\.json$/i)) return ["pyright"];
    return null;
  }
  return null;
}

function dotnetArgv(phase: ToolchainPhase): string[] | null {
  // dotnet SDK ships build/test/format — they always work if a .sln/.csproj exists.
  if (phase === "build") return ["dotnet", "build", "--nologo"];
  if (phase === "test") return ["dotnet", "test", "--nologo"];
  if (phase === "lint") return ["dotnet", "format", "--verify-no-changes"];
  // typecheck is built into build; format overlaps with lint above.
  return null;
}

function goArgv(phase: ToolchainPhase, cwd: string): string[] | null {
  if (phase === "build") return ["go", "build", "./..."];
  if (phase === "test") return ["go", "test", "./..."];
  if (phase === "lint") {
    if (
      existsSync(join(cwd, ".golangci.yml")) ||
      existsSync(join(cwd, ".golangci.yaml")) ||
      existsSync(join(cwd, ".golangci.toml"))
    ) {
      return ["golangci-lint", "run"];
    }
    return ["go", "vet", "./..."];
  }
  if (phase === "format") return ["gofmt", "-l", "."];
  // typecheck is built into build.
  return null;
}
