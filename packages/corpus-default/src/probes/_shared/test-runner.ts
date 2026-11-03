import type { EvidenceMap, Reading } from "@esbenwiberg/repofit/sdk";

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

/**
 * Whether a test runner is configured, across the major ecosystems; `na`
 * when no recognised project manifest exists. Shared by
 * `tests.runner-configured` and the probes that only make sense once a
 * runner exists.
 */
export async function detectTestRunner(ev: EvidenceMap): Promise<Reading> {
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
}
