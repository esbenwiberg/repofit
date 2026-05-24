import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { resolve, toolchainSubsystem } from "../src/evidence/subsystems/toolchain.js";
import type {
  DotnetProjectEvidence,
  GoModuleEvidence,
  NodePackageEvidence,
  PythonProjectEvidence,
} from "../src/sdk/types.js";

function emptyInputs() {
  const node: NodePackageEvidence = {
    present: false,
    dependencies: {},
    devDependencies: {},
    scripts: {},
    raw: null,
  };
  const python: PythonProjectEvidence = {
    present: false,
    pyproject: null,
    requirementsFiles: [],
    hasPoetryLock: false,
    hasUvLock: false,
    hasPipfileLock: false,
    hasSetupCfg: false,
    hasSetupPy: false,
  };
  const dotnet: DotnetProjectEvidence = {
    present: false,
    solutions: [],
    projects: [],
    centralPackageManagement: null,
  };
  const go: GoModuleEvidence = { present: false, modules: [] };
  return { node, python, dotnet, go };
}

describe("toolchain.resolve — stack detection", () => {
  test("empty repo → no stacks, no commands", () => {
    const out = resolve({ cwd: "/tmp/nope" }, emptyInputs());
    expect(out.stacks).toEqual([]);
    expect(out.primary).toBeNull();
    expect(out.commands.build).toBeNull();
    expect(out.commands.lint).toBeNull();
  });

  test("node only → primary=node", () => {
    const i = emptyInputs();
    i.node = { present: true, dependencies: {}, devDependencies: {}, scripts: {}, raw: {} };
    const out = resolve({ cwd: "/tmp/nope" }, i);
    expect(out.stacks).toEqual(["node"]);
    expect(out.primary).toBe("node");
  });

  test("node + python detected → primary=node by precedence", () => {
    const i = emptyInputs();
    i.node = { present: true, dependencies: {}, devDependencies: {}, scripts: {}, raw: {} };
    i.python = { ...i.python, present: true };
    const out = resolve({ cwd: "/tmp/nope" }, i);
    expect(out.stacks).toEqual(["node", "python"]);
    expect(out.primary).toBe("node");
  });

  test("node sidecar + configured python → primary=python by command coverage", () => {
    const i = emptyInputs();
    i.node = {
      present: true,
      dependencies: {},
      devDependencies: {},
      scripts: { dev: "vite" },
      raw: {},
    };
    i.python = {
      ...i.python,
      present: true,
      pyproject: {
        path: "pyproject.toml",
        hasBuildSystem: true,
        tools: [],
        toolHints: ["pytest", "ruff", "mypy"],
      },
    };
    const out = resolve({ cwd: "/tmp/nope" }, i);
    expect(out.stacks).toEqual(["python", "node"]);
    expect(out.primary).toBe("python");
    expect(out.commands.test).toEqual({ source: "python", argv: ["pytest"] });
    expect(out.commands.lint).toEqual({ source: "python", argv: ["ruff", "check", "."] });
  });

  test("primaryStack override is honoured when stack is detected", () => {
    const i = emptyInputs();
    i.node = { present: true, dependencies: {}, devDependencies: {}, scripts: {}, raw: {} };
    i.python = { ...i.python, present: true };
    const out = resolve({ cwd: "/tmp/nope", toolchain: { primaryStack: "python" } }, i);
    expect(out.primary).toBe("python");
  });

  test("primaryStack override falls back when stack not detected", () => {
    const i = emptyInputs();
    i.node = { present: true, dependencies: {}, devDependencies: {}, scripts: {}, raw: {} };
    const out = resolve({ cwd: "/tmp/nope", toolchain: { primaryStack: "go" } }, i);
    expect(out.primary).toBe("node");
  });
});

describe("toolchain.resolve — node defaults", () => {
  test("node with scripts → maps scripts to argv", () => {
    const i = emptyInputs();
    i.node = {
      present: true,
      dependencies: {},
      devDependencies: {},
      scripts: { build: "tsc", test: "vitest", lint: "biome check ." },
      raw: {},
    };
    const out = resolve({ cwd: "/tmp/nope" }, i);
    expect(out.commands.build).toEqual({
      source: "node",
      argv: ["npm", "run", "build", "--silent"],
    });
    expect(out.commands.test).toEqual({ source: "node", argv: ["npm", "test", "--silent"] });
    expect(out.commands.lint).toEqual({
      source: "node",
      argv: ["npm", "run", "lint", "--silent"],
    });
  });

  test("node without lint script → no lint command", () => {
    const i = emptyInputs();
    i.node = {
      present: true,
      dependencies: {},
      devDependencies: {},
      scripts: { build: "tsc" },
      raw: {},
    };
    const out = resolve({ cwd: "/tmp/nope" }, i);
    expect(out.commands.lint).toBeNull();
  });

  test("node 'format:check' preferred over 'format'", () => {
    const i = emptyInputs();
    i.node = {
      present: true,
      dependencies: {},
      devDependencies: {},
      scripts: { format: "biome format --write .", "format:check": "biome format ." },
      raw: {},
    };
    const out = resolve({ cwd: "/tmp/nope" }, i);
    expect(out.commands.format?.argv).toEqual(["npm", "run", "format:check", "--silent"]);
  });

  test("node prefers agent-safe test script over npm test", () => {
    const i = emptyInputs();
    i.node = {
      present: true,
      dependencies: {},
      devDependencies: {},
      scripts: { test: "playwright test", "test:agent": "vitest run --runInBand" },
      raw: {},
    };
    const out = resolve({ cwd: "/tmp/nope" }, i);
    expect(out.commands.test).toEqual({
      source: "node",
      argv: ["npm", "run", "test:agent", "--silent"],
    });
  });

  test("node e2e-only npm test is not auto-run in executed probes", () => {
    const i = emptyInputs();
    i.node = {
      present: true,
      dependencies: {},
      devDependencies: {},
      scripts: { test: "playwright test" },
      raw: {},
    };
    const out = resolve({ cwd: "/tmp/nope" }, i);
    expect(out.commands.test).toBeNull();
  });
});

describe("toolchain.resolve — python defaults", () => {
  test("ruff configured → ruff check + ruff format --check", () => {
    const i = emptyInputs();
    i.python = {
      ...i.python,
      present: true,
      pyproject: {
        path: "pyproject.toml",
        hasBuildSystem: true,
        tools: ["ruff"],
      },
    };
    const out = resolve({ cwd: "/tmp/nope" }, i);
    expect(out.commands.lint).toEqual({ source: "python", argv: ["ruff", "check", "."] });
    expect(out.commands.format).toEqual({
      source: "python",
      argv: ["ruff", "format", "--check", "."],
    });
    expect(out.commands.build).toEqual({ source: "python", argv: ["python", "-m", "build"] });
  });

  test("ruff + flake8 both configured → lint is ambiguous (null)", () => {
    const i = emptyInputs();
    i.python = {
      ...i.python,
      present: true,
      pyproject: { path: "pyproject.toml", hasBuildSystem: false, tools: ["ruff", "flake8"] },
    };
    const out = resolve({ cwd: "/tmp/nope" }, i);
    expect(out.commands.lint).toBeNull();
  });

  test("pytest configured → test command set", () => {
    const i = emptyInputs();
    i.python = {
      ...i.python,
      present: true,
      pyproject: { path: "pyproject.toml", hasBuildSystem: false, tools: ["pytest"] },
    };
    const out = resolve({ cwd: "/tmp/nope" }, i);
    expect(out.commands.test).toEqual({ source: "python", argv: ["pytest"] });
  });

  test("python tool hints from dependencies resolve default commands", () => {
    const i = emptyInputs();
    i.python = {
      ...i.python,
      present: true,
      pyproject: {
        path: "pyproject.toml",
        hasBuildSystem: false,
        tools: [],
        toolHints: ["black", "flake8", "pyright", "pytest"],
      },
    };
    const out = resolve({ cwd: "/tmp/nope" }, i);
    expect(out.commands.test).toEqual({ source: "python", argv: ["pytest"] });
    expect(out.commands.lint).toEqual({ source: "python", argv: ["flake8", "."] });
    expect(out.commands.format).toEqual({ source: "python", argv: ["black", "--check", "."] });
    expect(out.commands.typecheck).toEqual({ source: "python", argv: ["pyright"] });
  });

  test("no build-system → no build command", () => {
    const i = emptyInputs();
    i.python = {
      ...i.python,
      present: true,
      pyproject: { path: "pyproject.toml", hasBuildSystem: false, tools: ["ruff"] },
    };
    const out = resolve({ cwd: "/tmp/nope" }, i);
    expect(out.commands.build).toBeNull();
  });
});

describe("toolchain.resolve — dotnet defaults", () => {
  test("dotnet present → build/test/lint commands", () => {
    const i = emptyInputs();
    i.dotnet = {
      present: true,
      solutions: ["app.sln"],
      projects: [],
      centralPackageManagement: null,
    };
    const out = resolve({ cwd: "/tmp/nope" }, i);
    expect(out.commands.build).toEqual({
      source: "dotnet",
      argv: ["dotnet", "build", "--nologo"],
    });
    expect(out.commands.test).toEqual({ source: "dotnet", argv: ["dotnet", "test", "--nologo"] });
    expect(out.commands.lint).toEqual({
      source: "dotnet",
      argv: ["dotnet", "format", "--verify-no-changes"],
    });
    expect(out.commands.typecheck).toBeNull();
    expect(out.commands.format).toBeNull();
  });
});

describe("toolchain.resolve — go defaults", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "repofit-toolchain-go-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("go.mod only → go vet for lint", () => {
    const i = emptyInputs();
    i.go = { present: true, modules: [] };
    const out = resolve({ cwd: tmp }, i);
    expect(out.commands.lint).toEqual({ source: "go", argv: ["go", "vet", "./..."] });
  });

  test(".golangci.yml present → golangci-lint", () => {
    writeFileSync(join(tmp, ".golangci.yml"), "linters:\n  enable: [gosec]\n");
    const i = emptyInputs();
    i.go = { present: true, modules: [] };
    const out = resolve({ cwd: tmp }, i);
    expect(out.commands.lint).toEqual({ source: "go", argv: ["golangci-lint", "run"] });
  });
});

describe("toolchain.resolve — config overrides", () => {
  test("commands override wins over detected default and tags source=explicit", () => {
    const i = emptyInputs();
    i.node = {
      present: true,
      dependencies: {},
      devDependencies: {},
      scripts: { lint: "biome check ." },
      raw: {},
    };
    const out = resolve(
      { cwd: "/tmp/nope", toolchain: { commands: { lint: ["my", "custom", "lint"] } } },
      i,
    );
    expect(out.commands.lint).toEqual({ source: "explicit", argv: ["my", "custom", "lint"] });
  });

  test("empty override is ignored (falls back to default)", () => {
    const i = emptyInputs();
    i.node = {
      present: true,
      dependencies: {},
      devDependencies: {},
      scripts: { lint: "biome check ." },
      raw: {},
    };
    const out = resolve({ cwd: "/tmp/nope", toolchain: { commands: { lint: [] } } }, i);
    expect(out.commands.lint?.source).toBe("node");
  });

  test("override works even when no stack is detected", () => {
    const out = resolve(
      { cwd: "/tmp/nope", toolchain: { commands: { lint: ["my", "lint"] } } },
      emptyInputs(),
    );
    expect(out.commands.lint).toEqual({ source: "explicit", argv: ["my", "lint"] });
    // Other phases stay null because no stack and no override.
    expect(out.commands.build).toBeNull();
  });
});

describe("toolchain subsystem — gather end-to-end", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "repofit-toolchain-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function gitInit(cwd: string): void {
    execFileSync("git", ["init", "-q"], { cwd });
    execFileSync("git", ["add", "-A"], { cwd });
    execFileSync(
      "git",
      [
        "-c",
        "user.email=t@t",
        "-c",
        "user.name=t",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-qm",
        ".",
      ],
      { cwd },
    );
  }

  test("python repo with ruff → lint = ruff", async () => {
    writeFileSync(
      join(tmp, "pyproject.toml"),
      '[build-system]\nrequires = ["setuptools"]\n\n[tool.ruff]\nline-length = 100\n',
    );
    gitInit(tmp);
    const ev = await toolchainSubsystem.gather({ cwd: tmp });
    expect(ev.primary).toBe("python");
    expect(ev.commands.lint?.argv).toEqual(["ruff", "check", "."]);
    expect(ev.commands.build?.argv).toEqual(["python", "-m", "build"]);
  });
});
