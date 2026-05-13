import { defineProbe } from "@esbenwiberg/repofit/sdk";

const NODE_RUNNERS = [
  "vitest",
  "jest",
  "mocha",
  "ava",
  "node:test",
  "playwright",
  "@playwright/test",
];

const NODE_DEFAULT_TEST_SCRIPT = 'echo "Error: no test specified" && exit 1';

const PY_MANIFEST = /(?:^|\/)(?:pyproject\.toml|setup\.cfg|setup\.py|Pipfile)$/i;
const PY_REQUIREMENTS = /(?:^|\/)requirements(?:[-.][\w]+)?\.txt$/i;
const PY_TEST_CONFIG = /(?:^|\/)(?:pytest\.ini|tox\.ini|conftest\.py)$/i;
const PY_TEST_PATTERNS = [/\bpytest\b/i, /\bnose2?\b/i, /\btox\b/i];

const GO_MOD = /(?:^|\/)go\.mod$/i;
const RUST_MANIFEST = /(?:^|\/)Cargo\.toml$/i;

const JAVA_BUILD = /(?:^|\/)(?:pom\.xml|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?)$/i;
const JAVA_TEST_PATTERNS = [
  /\bjunit(?:[.-]?(?:jupiter|vintage|api))?\b/i,
  /\borg\.junit\b/i,
  /\btestng\b/i,
  /\bspock-core\b/i,
];

const DOTNET_CSPROJ = /\.csproj$/i;
const DOTNET_TEST_PATTERNS = [
  /<PackageReference\s+Include="(?:xunit|XUnit|Microsoft\.NET\.Test\.Sdk|NUnit|MSTest\.TestFramework)/i,
];

const RUBY_GEMFILE = /(?:^|\/)Gemfile$/;
const RUBY_TEST_PATTERNS = [/\brspec-core\b/i, /\brspec\b/i, /\bminitest\b/i];

async function anyMatchInFiles(
  paths: string[],
  patterns: RegExp[],
  readText: (p: string) => Promise<string | undefined>,
): Promise<boolean> {
  for (const p of paths) {
    const text = await readText(p);
    if (!text) continue;
    if (patterns.some((re) => re.test(text))) return true;
  }
  return false;
}

export default defineProbe({
  id: "tests.runner-configured",
  version: "1.1.0",
  dimensions: [{ id: "feedback", weight: 1 }],
  tier: "static",
  evidence: ["node_package", "files", "size_stats"],

  rationale: `
    An agent that can run tests can verify its own changes. This probe
    detects a configured test runner across the major language ecosystems:
    a JS test runner dep or non-default \`test\` script (Node), pytest /
    nose / tox or pytest config files (Python), \`go test\` (Go — built
    in if go.mod exists), \`cargo test\` (Rust — built in if Cargo.toml
    exists), junit / testng / spock in pom or gradle (Java), xunit /
    nunit / mstest in a .csproj (.NET), or rspec / minitest in Gemfile
    (Ruby).
  `,

  remediation:
    "Wire up a test runner: `vitest` / `jest` / `node --test` (Node), `pytest` (Python), `junit-jupiter` in pom.xml (Java), `xunit` + `Microsoft.NET.Test.Sdk` in .csproj (.NET), or `rspec` / `minitest` (Ruby). Even one passing smoke test is enough — the value is having a feedback loop the agent can run.",

  async detect(ev) {
    if (ev.node_package.present) {
      const hasRunnerDep = NODE_RUNNERS.some((r) => r in ev.node_package.devDependencies);
      const testScript = ev.node_package.scripts.test;
      const hasTestScript =
        typeof testScript === "string" &&
        testScript.trim().length > 0 &&
        testScript !== NODE_DEFAULT_TEST_SCRIPT;
      if (hasRunnerDep || hasTestScript) return { kind: "predicate", value: true };
    }

    const allPaths = ev.size_stats.files.map((f) => f.path);

    const pyManifests = allPaths.filter((p) => PY_MANIFEST.test(p) || PY_REQUIREMENTS.test(p));
    if (pyManifests.length > 0) {
      if (allPaths.some((p) => PY_TEST_CONFIG.test(p))) return { kind: "predicate", value: true };
      if (await anyMatchInFiles(pyManifests, PY_TEST_PATTERNS, ev.files.readText)) {
        return { kind: "predicate", value: true };
      }
    }

    if (allPaths.some((p) => GO_MOD.test(p))) return { kind: "predicate", value: true };
    if (allPaths.some((p) => RUST_MANIFEST.test(p))) return { kind: "predicate", value: true };

    const javaBuilds = allPaths.filter((p) => JAVA_BUILD.test(p));
    if (
      javaBuilds.length > 0 &&
      (await anyMatchInFiles(javaBuilds, JAVA_TEST_PATTERNS, ev.files.readText))
    ) {
      return { kind: "predicate", value: true };
    }

    const csprojs = allPaths.filter((p) => DOTNET_CSPROJ.test(p));
    if (
      csprojs.length > 0 &&
      (await anyMatchInFiles(csprojs, DOTNET_TEST_PATTERNS, ev.files.readText))
    ) {
      return { kind: "predicate", value: true };
    }

    const gemfiles = allPaths.filter((p) => RUBY_GEMFILE.test(p));
    if (
      gemfiles.length > 0 &&
      (await anyMatchInFiles(gemfiles, RUBY_TEST_PATTERNS, ev.files.readText))
    ) {
      return { kind: "predicate", value: true };
    }

    if (
      !ev.node_package.present &&
      pyManifests.length === 0 &&
      javaBuilds.length === 0 &&
      csprojs.length === 0 &&
      gemfiles.length === 0
    ) {
      return { kind: "na", reason: "no recognised project manifest" };
    }

    return { kind: "predicate", value: false };
  },

  score: { kind: "predicate", direction: "positive" },

  fixtures: [
    {
      name: "no-manifest",
      evidence: {
        node_package: { present: false },
        size_stats: { files: [], totalBytes: 0, totalFiles: 0, source: "git-ls-files" },
      },
      expect: { reading: { kind: "na", reason: "no recognised project manifest" }, score: null },
    },
    {
      name: "vitest-devdep",
      evidence: {
        node_package: { present: true, devDependencies: { vitest: "^1.0.0" } },
        size_stats: { files: [], totalBytes: 0, totalFiles: 0, source: "git-ls-files" },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "test-script-only",
      evidence: {
        node_package: { present: true, scripts: { test: "node --test" } },
        size_stats: { files: [], totalBytes: 0, totalFiles: 0, source: "git-ls-files" },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "npm-init-default-test-script",
      evidence: {
        node_package: {
          present: true,
          scripts: { test: 'echo "Error: no test specified" && exit 1' },
        },
        size_stats: { files: [], totalBytes: 0, totalFiles: 0, source: "git-ls-files" },
      },
      expect: { reading: { kind: "predicate", value: false }, score: 0 },
    },
    {
      name: "python-pytest-in-pyproject",
      evidence: {
        files: { "pyproject.toml": '[tool.poetry.dev-dependencies]\npytest = "^8"\n' },
        node_package: { present: false },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 50,
          totalFiles: 1,
          files: [{ path: "pyproject.toml", bytes: 50, lines: 3, depth: 0 }],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "python-conftest-only",
      evidence: {
        files: { "pyproject.toml": "[project]\nname = 'x'\n" },
        node_package: { present: false },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 2,
          files: [
            { path: "pyproject.toml", bytes: 30, lines: 2, depth: 0 },
            { path: "tests/conftest.py", bytes: 70, lines: 5, depth: 1 },
          ],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "go-mod-present",
      evidence: {
        node_package: { present: false },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 1,
          files: [{ path: "go.mod", bytes: 100, lines: 5, depth: 0 }],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "cargo-toml-present",
      evidence: {
        node_package: { present: false },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 1,
          files: [{ path: "Cargo.toml", bytes: 100, lines: 5, depth: 0 }],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "junit-in-pom",
      evidence: {
        files: {
          "pom.xml":
            "<dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId></dependency>",
        },
        node_package: { present: false },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 200,
          totalFiles: 1,
          files: [{ path: "pom.xml", bytes: 200, lines: 5, depth: 0 }],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "xunit-in-csproj",
      evidence: {
        files: {
          "tests/UnitTests.csproj":
            '<Project><ItemGroup><PackageReference Include="xunit" Version="2.5.0"/></ItemGroup></Project>',
        },
        node_package: { present: false },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 200,
          totalFiles: 1,
          files: [{ path: "tests/UnitTests.csproj", bytes: 200, lines: 5, depth: 1 }],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "rspec-in-gemfile",
      evidence: {
        files: { Gemfile: "source 'https://rubygems.org'\ngem 'rspec'\n" },
        node_package: { present: false },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 50,
          totalFiles: 1,
          files: [{ path: "Gemfile", bytes: 50, lines: 3, depth: 0 }],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "java-no-test-dep",
      evidence: {
        files: { "pom.xml": "<project><groupId>x</groupId></project>" },
        node_package: { present: false },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 1,
          files: [{ path: "pom.xml", bytes: 100, lines: 5, depth: 0 }],
        },
      },
      expect: { reading: { kind: "predicate", value: false }, score: 0 },
    },
  ],
});
