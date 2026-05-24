import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { pythonProjectSubsystem } from "../src/evidence/subsystems/python-project.js";

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

describe("python_project subsystem", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "repofit-py-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("repo with no python files → not present", async () => {
    writeFileSync(join(tmp, "README.md"), "hi");
    gitInit(tmp);
    const ev = await pythonProjectSubsystem.gather({ cwd: tmp });
    expect(ev.present).toBe(false);
  });

  test("requirements.txt only → present, no pyproject", async () => {
    writeFileSync(join(tmp, "requirements.txt"), "flask==2.0\n");
    gitInit(tmp);
    const ev = await pythonProjectSubsystem.gather({ cwd: tmp });
    expect(ev.present).toBe(true);
    expect(ev.pyproject).toBeNull();
    expect(ev.requirementsFiles).toEqual(["requirements.txt"]);
  });

  test("pyproject with build-system + tool sections + project name", async () => {
    writeFileSync(
      join(tmp, "pyproject.toml"),
      `[build-system]
requires = ["setuptools"]

[project]
name = "example-app"
version = "0.1.0"

[tool.ruff]
line-length = 100

[tool.ruff.lint]
select = ["E"]

[tool.mypy]
strict = true

[tool.pytest.ini_options]
testpaths = ["tests"]
`,
    );
    writeFileSync(join(tmp, "pytest.ini"), "[pytest]\ntestpaths = tests\n");
    writeFileSync(join(tmp, "requirements-dev.txt"), "pyright==1.1.0\nblack>=24\n");
    gitInit(tmp);
    const ev = await pythonProjectSubsystem.gather({ cwd: tmp });
    expect(ev.present).toBe(true);
    expect(ev.pyproject?.path).toBe("pyproject.toml");
    expect(ev.pyproject?.hasBuildSystem).toBe(true);
    expect(ev.pyproject?.projectName).toBe("example-app");
    expect(ev.pyproject?.tools).toEqual(["mypy", "pytest", "ruff"]);
    expect(ev.pyproject?.toolHints).toEqual(["mypy", "pytest", "ruff"]);
    expect(ev.requirementsToolHints).toEqual(["black", "pyright"]);
    expect(ev.configFiles).toEqual(["pytest.ini"]);
  });

  test("detects poetry/uv/Pipfile lock and setup.cfg/py", async () => {
    writeFileSync(join(tmp, "pyproject.toml"), "[tool.poetry]\nname = 'x'\n");
    writeFileSync(join(tmp, "poetry.lock"), "");
    writeFileSync(join(tmp, "uv.lock"), "");
    writeFileSync(join(tmp, "setup.cfg"), "[metadata]\nname = x\n");
    writeFileSync(join(tmp, "setup.py"), "from setuptools import setup\n");
    gitInit(tmp);
    const ev = await pythonProjectSubsystem.gather({ cwd: tmp });
    expect(ev.hasPoetryLock).toBe(true);
    expect(ev.hasUvLock).toBe(true);
    expect(ev.hasSetupCfg).toBe(true);
    expect(ev.hasSetupPy).toBe(true);
    expect(ev.pyproject?.tools).toContain("poetry");
  });

  test("pyproject without build-system → hasBuildSystem=false", async () => {
    writeFileSync(join(tmp, "pyproject.toml"), "[tool.ruff]\nline-length = 100\n");
    gitInit(tmp);
    const ev = await pythonProjectSubsystem.gather({ cwd: tmp });
    expect(ev.pyproject?.hasBuildSystem).toBe(false);
    expect(ev.pyproject?.tools).toEqual(["ruff"]);
  });

  test("nested pyproject prefers root-level one", async () => {
    mkdirSync(join(tmp, "subpkg"));
    writeFileSync(join(tmp, "pyproject.toml"), '[project]\nname = "root"\n');
    writeFileSync(join(tmp, "subpkg/pyproject.toml"), '[project]\nname = "sub"\n');
    gitInit(tmp);
    const ev = await pythonProjectSubsystem.gather({ cwd: tmp });
    expect(ev.pyproject?.projectName).toBe("root");
  });
});
