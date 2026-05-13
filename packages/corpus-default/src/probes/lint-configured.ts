import { defineProbe } from "@esbenwiberg/repofit/sdk";

const NODE_LINTERS = ["@biomejs/biome", "eslint", "oxlint", "rome", "standard", "xo"];

const PY_MANIFEST = /(?:^|\/)(?:pyproject\.toml|setup\.cfg|setup\.py|Pipfile)$/i;
const PY_REQUIREMENTS = /(?:^|\/)requirements(?:[-.][\w]+)?\.txt$/i;
const PY_LINT_CONFIG = /(?:^|\/)(?:\.flake8|\.pylintrc|ruff\.toml)$/i;
const PY_LINT_PATTERNS = [
  /\bruff\b/i,
  /\bflake8\b/i,
  /\bpylint\b/i,
  /\bpyflakes\b/i,
  /\bmypy\b/i,
  /\bpyright\b/i,
  /\[tool\.ruff\b/i,
  /\[tool\.mypy\b/i,
];

const GO_MOD = /(?:^|\/)go\.mod$/i;
const GO_LINT_CONFIG = /(?:^|\/)\.golangci\.(?:ya?ml|toml)$/i;

const RUST_MANIFEST = /(?:^|\/)Cargo\.toml$/i;

const JAVA_BUILD = /(?:^|\/)(?:pom\.xml|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?)$/i;
const JAVA_LINT_PATTERNS = [
  /\bcheckstyle\b/i,
  /\bspotbugs\b/i,
  /\bpmd\b/i,
  /\berrorprone\b/i,
  /\berror-prone\b/i,
  /\bdetekt\b/i,
  /\bktlint\b/i,
];

const DOTNET_CSPROJ = /\.csproj$/i;
const DOTNET_LINT_PATTERNS = [
  /<PackageReference\s+Include="(?:StyleCop|Microsoft\.CodeAnalysis|Roslynator|SonarAnalyzer)/i,
];

const RUBY_GEMFILE = /(?:^|\/)Gemfile$/;
const RUBY_LINT_PATTERNS = [/\brubocop\b/i, /\bstandardrb\b/i, /\bstandard\b/i, /\breek\b/i];

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
  id: "lint.configured",
  version: "1.1.0",
  dimensions: [{ id: "feedback", weight: 1 }],
  tier: "static",
  evidence: ["node_package", "files", "size_stats"],

  rationale: `
    A configured linter gives the agent a fast, deterministic check that
    its diff doesn't break local conventions. This probe detects one
    across the major ecosystems: biome / eslint / oxlint or a \`lint\`
    script (Node), ruff / flake8 / pylint / mypy (Python), golangci-lint
    via .golangci.yml (Go — \`go vet\` is built in regardless), clippy
    via [lints.clippy] in Cargo.toml (Rust — \`cargo clippy\` ships with
    the toolchain), checkstyle / spotbugs / errorprone / ktlint (Java),
    StyleCop / Roslynator analyzers (.NET), or rubocop / standardrb
    (Ruby).
  `,

  remediation:
    "Add a linter: `@biomejs/biome` or `eslint` (Node), `ruff` / `flake8` / `mypy` (Python), `checkstyle` / `spotbugs` in pom.xml (Java), `StyleCop.Analyzers` in .csproj (.NET), or `rubocop` (Ruby). Go and Rust ship with `go vet` / `cargo clippy`.",

  async detect(ev) {
    if (ev.node_package.present) {
      const hasLinterDep = NODE_LINTERS.some((l) => l in ev.node_package.devDependencies);
      const hasLintScript = typeof ev.node_package.scripts.lint === "string";
      if (hasLinterDep || hasLintScript) return { kind: "predicate", value: true };
    }

    const allPaths = ev.size_stats.files.map((f) => f.path);

    const pyManifests = allPaths.filter((p) => PY_MANIFEST.test(p) || PY_REQUIREMENTS.test(p));
    if (pyManifests.length > 0) {
      if (allPaths.some((p) => PY_LINT_CONFIG.test(p))) return { kind: "predicate", value: true };
      if (await anyMatchInFiles(pyManifests, PY_LINT_PATTERNS, ev.files.readText)) {
        return { kind: "predicate", value: true };
      }
    }

    if (allPaths.some((p) => GO_MOD.test(p))) {
      // `go vet` is built into the toolchain. .golangci.yml is a stronger signal but optional.
      if (allPaths.some((p) => GO_LINT_CONFIG.test(p))) return { kind: "predicate", value: true };
      return { kind: "predicate", value: true };
    }

    const rustManifests = allPaths.filter((p) => RUST_MANIFEST.test(p));
    if (rustManifests.length > 0) {
      // clippy ships with rustup; explicit [lints.clippy] config is a strong signal,
      // but presence of Cargo.toml alone is enough since `cargo clippy` is always available.
      return { kind: "predicate", value: true };
    }

    const javaBuilds = allPaths.filter((p) => JAVA_BUILD.test(p));
    if (
      javaBuilds.length > 0 &&
      (await anyMatchInFiles(javaBuilds, JAVA_LINT_PATTERNS, ev.files.readText))
    ) {
      return { kind: "predicate", value: true };
    }

    const csprojs = allPaths.filter((p) => DOTNET_CSPROJ.test(p));
    if (
      csprojs.length > 0 &&
      (await anyMatchInFiles(csprojs, DOTNET_LINT_PATTERNS, ev.files.readText))
    ) {
      return { kind: "predicate", value: true };
    }

    const gemfiles = allPaths.filter((p) => RUBY_GEMFILE.test(p));
    if (
      gemfiles.length > 0 &&
      (await anyMatchInFiles(gemfiles, RUBY_LINT_PATTERNS, ev.files.readText))
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
      name: "biome-devdep",
      evidence: {
        node_package: { present: true, devDependencies: { "@biomejs/biome": "^2.0.0" } },
        size_stats: { files: [], totalBytes: 0, totalFiles: 0, source: "git-ls-files" },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "lint-script-only",
      evidence: {
        node_package: { present: true, scripts: { lint: "tsc --noEmit" } },
        size_stats: { files: [], totalBytes: 0, totalFiles: 0, source: "git-ls-files" },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "python-ruff-in-pyproject",
      evidence: {
        files: { "pyproject.toml": "[tool.ruff]\nline-length = 100\n" },
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
      name: "python-flake8-config",
      evidence: {
        files: { "pyproject.toml": "[project]\nname = 'x'\n" },
        node_package: { present: false },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 2,
          files: [
            { path: "pyproject.toml", bytes: 30, lines: 2, depth: 0 },
            { path: ".flake8", bytes: 70, lines: 3, depth: 0 },
          ],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "go-mod-builtin-vet",
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
      name: "rust-builtin-clippy",
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
      name: "java-checkstyle",
      evidence: {
        files: {
          "pom.xml": "<plugin><artifactId>maven-checkstyle-plugin</artifactId></plugin>",
        },
        node_package: { present: false },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 1,
          files: [{ path: "pom.xml", bytes: 100, lines: 5, depth: 0 }],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "dotnet-stylecop",
      evidence: {
        files: {
          "App.csproj":
            '<Project><ItemGroup><PackageReference Include="StyleCop.Analyzers" Version="1.2.0"/></ItemGroup></Project>',
        },
        node_package: { present: false },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 200,
          totalFiles: 1,
          files: [{ path: "App.csproj", bytes: 200, lines: 3, depth: 0 }],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "ruby-rubocop",
      evidence: {
        files: { Gemfile: "source 'https://rubygems.org'\ngem 'rubocop'\n" },
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
      name: "java-no-linter",
      evidence: {
        files: { "pom.xml": "<project><groupId>x</groupId></project>" },
        node_package: { present: false },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 50,
          totalFiles: 1,
          files: [{ path: "pom.xml", bytes: 50, lines: 3, depth: 0 }],
        },
      },
      expect: { reading: { kind: "predicate", value: false }, score: 0 },
    },
    {
      name: "node-no-linter",
      evidence: {
        node_package: { present: true },
        size_stats: { files: [], totalBytes: 0, totalFiles: 0, source: "git-ls-files" },
      },
      expect: { reading: { kind: "predicate", value: false }, score: 0 },
    },
  ],
});
