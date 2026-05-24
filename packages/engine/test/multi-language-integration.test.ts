import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import formatConfigured from "../../corpus-default/src/probes/format-configured.js";
import hooksGates from "../../corpus-default/src/probes/hooks-gates-lint-test-build.js";
import lintConfigured from "../../corpus-default/src/probes/lint-configured.js";
import testsRunner from "../../corpus-default/src/probes/tests-runner-configured.js";
import { gatherAll } from "../src/evidence/registry.js";

type Tree = Record<string, string>;

function makeRepo(files: Tree): string {
  const root = mkdtempSync(join(tmpdir(), "repofit-integration-"));
  for (const [path, content] of Object.entries(files)) {
    const abs = join(root, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root, env });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root, env });
  execFileSync("git", ["config", "user.name", "test"], { cwd: root, env });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: root, env });
  execFileSync("git", ["add", "-A"], { cwd: root, env });
  execFileSync("git", ["commit", "-q", "--no-verify", "-m", "init"], { cwd: root, env });
  return root;
}

describe("multi-language integration (real fs + git)", () => {
  const created: string[] = [];

  beforeEach(() => {
    created.length = 0;
  });

  afterEach(() => {
    for (const root of created) rmSync(root, { recursive: true, force: true });
  });

  function setup(files: Tree): string {
    const root = makeRepo(files);
    created.push(root);
    return root;
  }

  test("python repo with ruff + pytest detected by format/lint/tests", async () => {
    const cwd = setup({
      "pyproject.toml": `[project]
name = "demo"

[tool.ruff]
line-length = 100

[tool.ruff.format]
quote-style = "double"

[tool.poetry.group.dev.dependencies]
pytest = "^8"
`,
      "src/demo/__init__.py": "",
      "tests/test_demo.py": "def test_ok():\n    assert True\n",
      "tests/conftest.py": "",
    });

    const ev = await gatherAll({ cwd });
    expect(ev.node_package.present).toBe(false);

    const fmt = await formatConfigured.detect(ev);
    expect(fmt).toEqual({ kind: "predicate", value: true });

    const lint = await lintConfigured.detect(ev);
    expect(lint).toEqual({ kind: "predicate", value: true });

    const tests = await testsRunner.detect(ev);
    expect(tests).toEqual({ kind: "predicate", value: true });
  });

  test("python repo stays primary when a node sidecar package is present", async () => {
    const cwd = setup({
      "package.json": JSON.stringify({ scripts: { dev: "vite" }, devDependencies: { vite: "^7" } }),
      "pyproject.toml": `[project]
name = "demo"
dependencies = ["pytest>=8", "ruff>=0.6", "mypy>=1"]

[build-system]
requires = ["setuptools"]
`,
      "src/demo/__init__.py": "",
      "tests/test_demo.py": "def test_ok():\n    assert True\n",
    });

    const ev = await gatherAll({ cwd });
    expect(ev.node_package.present).toBe(true);
    expect(ev.toolchain.stacks).toEqual(["python", "node"]);
    expect(ev.toolchain.primary).toBe("python");
    expect(ev.toolchain.commands.test?.argv).toEqual(["pytest"]);
    expect(ev.toolchain.commands.lint?.argv).toEqual(["ruff", "check", "."]);
    expect(ev.toolchain.commands.typecheck?.argv).toEqual(["mypy", "."]);
  });

  test("go module gets format/lint/tests via built-in toolchain", async () => {
    const cwd = setup({
      "go.mod": "module example.com/demo\n\ngo 1.22\n",
      "main.go": "package main\n\nfunc main() {}\n",
      "main_test.go": 'package main\n\nimport "testing"\n\nfunc TestX(t *testing.T) {}\n',
    });

    const ev = await gatherAll({ cwd });

    const fmt = await formatConfigured.detect(ev);
    expect(fmt).toEqual({ kind: "predicate", value: true });

    const lint = await lintConfigured.detect(ev);
    expect(lint).toEqual({ kind: "predicate", value: true });

    const tests = await testsRunner.detect(ev);
    expect(tests).toEqual({ kind: "predicate", value: true });
  });

  test("rust crate gets format/lint/tests via Cargo.toml", async () => {
    const cwd = setup({
      "Cargo.toml": `[package]
name = "demo"
version = "0.1.0"
edition = "2021"

[lints.clippy]
all = "warn"
`,
      "src/lib.rs":
        "pub fn add(a: i32, b: i32) -> i32 { a + b }\n\n#[cfg(test)]\nmod tests { #[test] fn t() {} }\n",
    });

    const ev = await gatherAll({ cwd });

    expect(await formatConfigured.detect(ev)).toEqual({ kind: "predicate", value: true });
    expect(await lintConfigured.detect(ev)).toEqual({ kind: "predicate", value: true });
    expect(await testsRunner.detect(ev)).toEqual({ kind: "predicate", value: true });
  });

  test("ruby project with rspec + rubocop", async () => {
    const cwd = setup({
      Gemfile: `source 'https://rubygems.org'
gem 'rspec'
gem 'rubocop'
`,
      "lib/demo.rb": "module Demo; end\n",
      "spec/demo_spec.rb": "describe Demo do\nend\n",
    });

    const ev = await gatherAll({ cwd });

    expect(await formatConfigured.detect(ev)).toEqual({ kind: "predicate", value: true });
    expect(await lintConfigured.detect(ev)).toEqual({ kind: "predicate", value: true });
    expect(await testsRunner.detect(ev)).toEqual({ kind: "predicate", value: true });
  });

  test("java maven project with junit + spotless + checkstyle", async () => {
    const cwd = setup({
      "pom.xml": `<project>
  <groupId>com.example</groupId>
  <artifactId>demo</artifactId>
  <build>
    <plugins>
      <plugin><groupId>com.diffplug.spotless</groupId><artifactId>spotless-maven-plugin</artifactId></plugin>
      <plugin><artifactId>maven-checkstyle-plugin</artifactId></plugin>
    </plugins>
  </build>
  <dependencies>
    <dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId></dependency>
  </dependencies>
</project>
`,
      "src/main/java/com/example/Demo.java": "package com.example; class Demo {}\n",
    });

    const ev = await gatherAll({ cwd });

    expect(await formatConfigured.detect(ev)).toEqual({ kind: "predicate", value: true });
    expect(await lintConfigured.detect(ev)).toEqual({ kind: "predicate", value: true });
    expect(await testsRunner.detect(ev)).toEqual({ kind: "predicate", value: true });
  });

  test("dotnet project with xunit + stylecop + .editorconfig", async () => {
    const cwd = setup({
      ".editorconfig": "[*.cs]\nindent_size = 4\n",
      "Demo.csproj": `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="xunit" Version="2.5.0"/>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.0.0"/>
    <PackageReference Include="StyleCop.Analyzers" Version="1.2.0"/>
  </ItemGroup>
</Project>
`,
      "Program.cs": "namespace Demo;\nclass Program { static void Main() {} }\n",
    });

    const ev = await gatherAll({ cwd });

    expect(await formatConfigured.detect(ev)).toEqual({ kind: "predicate", value: true });
    expect(await lintConfigured.detect(ev)).toEqual({ kind: "predicate", value: true });
    expect(await testsRunner.detect(ev)).toEqual({ kind: "predicate", value: true });
  });

  test("bare python repo without tooling scores false (not na)", async () => {
    const cwd = setup({
      "pyproject.toml": "[project]\nname = 'demo'\n",
      "demo.py": "print('hi')\n",
    });

    const ev = await gatherAll({ cwd });

    expect(await formatConfigured.detect(ev)).toEqual({ kind: "predicate", value: false });
    expect(await lintConfigured.detect(ev)).toEqual({ kind: "predicate", value: false });
  });

  test("empty repo with no manifests returns na", async () => {
    const cwd = setup({
      "README.md": "# nothing\n",
    });

    const ev = await gatherAll({ cwd });

    const fmt = await formatConfigured.detect(ev);
    expect(fmt.kind).toBe("na");

    const lint = await lintConfigured.detect(ev);
    expect(lint.kind).toBe("na");

    const tests = await testsRunner.detect(ev);
    expect(tests.kind).toBe("na");
  });

  test("hooks gates detect go-toolchain gates in a real pre-commit script", async () => {
    const cwd = setup({
      "go.mod": "module example.com/demo\n\ngo 1.22\n",
      ".githooks/pre-commit":
        "#!/usr/bin/env bash\nset -e\ngolangci-lint run\ngofmt -l .\ngo test ./...\ngo build ./...\n",
    });

    const ev = await gatherAll({ cwd });
    const reading = await hooksGates.detect(ev);
    expect(reading).toEqual({ kind: "count", value: 4 });
  });
});
