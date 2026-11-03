import { defineProbe } from "@esbenwiberg/repofit/sdk";
import { detectTestRunner } from "./_shared/test-runner.js";

const CONFIG_FILES: readonly RegExp[] = [
  /(^|\/)stryker\.(?:config|conf)\.(?:js|cjs|mjs|json|ts)$/i,
  /(^|\/)stryker-config\.json$/i,
  /(^|\/)\.cargo\/mutants\.toml$/,
  /(^|\/)\.gremlins\.ya?ml$/,
  /(^|\/)\.mutmut-config\.py$/,
];
const NODE_PACKAGES = ["@stryker-mutator/core"];
const PY_MANIFEST = /(?:^|\/)(?:pyproject\.toml|setup\.cfg|tox\.ini)$/i;
const PY_PATTERNS = [
  /\[tool\.mutmut\]/,
  /\[tool\.cosmic-ray\]/,
  /\[mutmut\]/,
  /\bmutmut\b/,
  /\bcosmic-ray\b/,
];
const CARGO_MANIFEST = /(?:^|\/)Cargo\.toml$/;
const CARGO_PATTERNS = [/\[workspace\.metadata\.mutants\]/, /\[package\.metadata\.mutants\]/];
const DOTNET_PROJECT = /\.csproj$/i;
const DOTNET_PATTERNS = [/StrykerMutator/i, /dotnet-stryker/i];
const DOTNET_TOOLS = /(?:^|\/)\.config\/dotnet-tools\.json$/;

/**
 * A package script that names mutation testing (`test:mutation`,
 * `mutants`) or invokes a tool (`stryker run`, `mutmut run`, `cargo
 * mutants`). A bare `mutation` token is not enough: `codegen:mutations`
 * generates GraphQL mutations and `db:mutate` seeds a database. A curated, home-grown mutation script is accepted on the same
 * footing as a tool: it is still a configured artefact that edits code and
 * expects tests to fail.
 */
/** Tool names stand on their own; `mutation` needs a testing token beside it. */
const TOOL_NAME_TOKENS = new Set(["mutants", "stryker", "mutmut"]);
const MUTATION_NAME_TOKENS = new Set(["mutation", "mutations", "mutate"]);
const TESTING_NAME_TOKENS = new Set(["test", "tests", "testing", "verify", "check"]);
const SCRIPT_COMMAND_PATTERNS = [
  /\bstryker\b/i,
  /\bmutmut\b/i,
  /\bcargo\s+mutants\b/i,
  /\bcosmic-ray\b/i,
  /\bgremlins\b/i,
  /\bmutation[-_ ]?test/i,
];

function scriptRunsMutationTesting(name: string, command: string): boolean {
  const tokens = name.toLowerCase().split(/[:._-]/);
  if (tokens.some((token) => TOOL_NAME_TOKENS.has(token))) return true;
  const namesMutation = tokens.some((token) => MUTATION_NAME_TOKENS.has(token));
  const namesTesting = tokens.some((token) => TESTING_NAME_TOKENS.has(token));
  if (namesMutation && namesTesting) return true;
  return SCRIPT_COMMAND_PATTERNS.some((re) => re.test(command));
}

async function anyMatch(
  paths: string[],
  patterns: RegExp[],
  readText: (p: string) => Promise<string | undefined>,
): Promise<boolean> {
  for (const p of paths) {
    const text = await readText(p);
    if (text && patterns.some((re) => re.test(text))) return true;
  }
  return false;
}

export default defineProbe({
  id: "tests.mutation-configured",
  version: "1.0.1",
  dimensions: [{ id: "feedback", weight: 0.5 }],
  tier: "static",
  evidence: ["node_package", "files", "size_stats"],

  rationale: `
    A passing suite proves little about what the tests would catch. A
    mutation-testing tool is the one configured artefact that measures
    oracle strength: it edits the code and expects a failure. This probe
    checks for a configured tool (Stryker, Stryker.NET, mutmut,
    cosmic-ray, cargo-mutants, gremlins) or a package script that names or
    invokes mutation testing; it does not run one, because a mutation score
    takes minutes and belongs to an opt-in executed probe.
  `,

  remediation:
    "Configure a mutation tool for the stack: `@stryker-mutator/core` with `stryker.config.mjs` (JS/TS), `mutmut` under `[tool.mutmut]` in `pyproject.toml` (Python), `cargo-mutants` with `.cargo/mutants.toml` (Rust), `dotnet-stryker` with `stryker-config.json` (.NET), or `.gremlins.yaml` (Go). Start with one package and a low threshold; the first run shows which tests assert nothing.",

  async detect(ev) {
    const runner = await detectTestRunner(ev);
    if (runner.kind !== "predicate" || !runner.value) {
      return { kind: "na", reason: "no test runner configured" };
    }
    const paths = ev.size_stats.files.map((f) => f.path);
    if (paths.some((p) => CONFIG_FILES.some((re) => re.test(p)))) {
      return { kind: "predicate", value: true };
    }
    if (ev.node_package.present) {
      const deps = { ...ev.node_package.dependencies, ...ev.node_package.devDependencies };
      if (NODE_PACKAGES.some((name) => name in deps)) return { kind: "predicate", value: true };
      for (const [name, command] of Object.entries(ev.node_package.scripts ?? {})) {
        if (scriptRunsMutationTesting(name, command)) return { kind: "predicate", value: true };
      }
    }
    const read = ev.files.readText;
    if (
      await anyMatch(
        paths.filter((p) => PY_MANIFEST.test(p)),
        PY_PATTERNS,
        read,
      )
    ) {
      return { kind: "predicate", value: true };
    }
    if (
      await anyMatch(
        paths.filter((p) => CARGO_MANIFEST.test(p)),
        CARGO_PATTERNS,
        read,
      )
    ) {
      return { kind: "predicate", value: true };
    }
    const dotnet = paths.filter((p) => DOTNET_PROJECT.test(p) || DOTNET_TOOLS.test(p));
    if (await anyMatch(dotnet, DOTNET_PATTERNS, read)) return { kind: "predicate", value: true };
    return { kind: "predicate", value: false };
  },

  score: { kind: "predicate", direction: "positive" },

  fixtures: [
    {
      name: "no-test-runner",
      evidence: {
        node_package: { present: true, scripts: {} },
        files: {},
        size_stats: { source: "git-ls-files", totalBytes: 0, totalFiles: 0, files: [] },
      },
      expect: { reading: { kind: "na", reason: "no test runner configured" }, score: null },
    },
    {
      name: "runner-without-mutation",
      evidence: {
        node_package: {
          present: true,
          scripts: { test: "vitest run" },
          devDependencies: { vitest: "^3" },
        },
        files: {},
        size_stats: { source: "git-ls-files", totalBytes: 0, totalFiles: 0, files: [] },
      },
      expect: { reading: { kind: "predicate", value: false }, score: 0 },
    },
    {
      name: "stryker-dependency",
      evidence: {
        node_package: {
          present: true,
          scripts: { test: "vitest run" },
          devDependencies: { vitest: "^3", "@stryker-mutator/core": "^9" },
        },
        files: {},
        size_stats: { source: "git-ls-files", totalBytes: 0, totalFiles: 0, files: [] },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "own-mutation-script",
      evidence: {
        node_package: {
          present: true,
          scripts: {
            test: "vitest run",
            "test:mutation": "node scripts/verify-engine-mutations.mjs",
            "verify:local": "npm run test:coverage && npm run test:mutation",
          },
          devDependencies: { vitest: "^3" },
        },
        files: {},
        size_stats: { source: "git-ls-files", totalBytes: 0, totalFiles: 0, files: [] },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "graphql-mutations-codegen-is-not-mutation-testing",
      evidence: {
        node_package: {
          present: true,
          scripts: {
            test: "vitest run",
            "codegen:mutations": "graphql-codegen --config mutations.yml",
            "db:mutate": "node scripts/seed.js",
          },
          devDependencies: { vitest: "^3" },
        },
        files: {},
        size_stats: { source: "git-ls-files", totalBytes: 0, totalFiles: 0, files: [] },
      },
      expect: { reading: { kind: "predicate", value: false }, score: 0 },
    },
    {
      name: "mutmut-in-pyproject",
      evidence: {
        node_package: { present: false },
        files: {
          "pyproject.toml":
            '[tool.pytest.ini_options]\n\n[tool.mutmut]\npaths_to_mutate = "src/"\n',
        },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 60,
          totalFiles: 1,
          files: [{ path: "pyproject.toml", bytes: 60, lines: 4, depth: 0 }],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "cargo-mutants-config-file",
      evidence: {
        node_package: { present: false },
        files: { "Cargo.toml": '[package]\nname = "x"\n' },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 20,
          totalFiles: 2,
          files: [
            { path: "Cargo.toml", bytes: 20, lines: 2, depth: 0 },
            { path: ".cargo/mutants.toml", bytes: 0, lines: 0, depth: 1 },
          ],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
  ],
});
