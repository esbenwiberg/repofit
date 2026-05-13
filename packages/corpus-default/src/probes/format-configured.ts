import { defineProbe } from "@esbenwiberg/repofit/sdk";

const NODE_FORMATTERS = ["prettier", "@biomejs/biome", "dprint"];

const PY_MANIFEST = /(?:^|\/)(?:pyproject\.toml|setup\.cfg|setup\.py|Pipfile)$/i;
const PY_REQUIREMENTS = /(?:^|\/)requirements(?:[-.][\w]+)?\.txt$/i;
const PY_FORMAT_PATTERNS = [
  /\bblack\b/i,
  /\bautopep8\b/i,
  /\byapf\b/i,
  /\bisort\b/i,
  /\[tool\.ruff(?:\.format)?\]/i,
  /\bruff\b/i,
];

const GO_MOD = /(?:^|\/)go\.mod$/i;
const RUST_MANIFEST = /(?:^|\/)Cargo\.toml$/i;

const JAVA_BUILD = /(?:^|\/)(?:pom\.xml|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?)$/i;
const JAVA_FORMAT_PATTERNS = [
  /\bspotless\b/i,
  /\bgoogle-java-format\b/i,
  /\bmaven-formatter-plugin\b/i,
  /\bpalantir-java-format\b/i,
];

const DOTNET_CSPROJ = /\.csproj$/i;
const DOTNET_FORMAT_PATTERNS = [/<PackageReference\s+Include="CSharpier/i];

const RUBY_GEMFILE = /(?:^|\/)Gemfile$/;
const RUBY_FORMAT_PATTERNS = [/\brubocop\b/i, /\bstandardrb\b/i, /\bstandard\b/i];

const EDITORCONFIG = ".editorconfig";

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
  id: "format.configured",
  version: "1.1.0",
  dimensions: [{ id: "consistency", weight: 1 }],
  tier: "static",
  evidence: ["node_package", "files", "size_stats"],

  rationale: `
    A configured formatter is the cheapest insurance that an agent's diff
    blends in with the rest of the codebase. This probe detects one across
    the major ecosystems: prettier / biome / dprint or a \`format\` script
    (Node), black / ruff / autopep8 / yapf / isort (Python), \`gofmt\`
    (Go — built in with go.mod), \`rustfmt\` (Rust — built in with
    Cargo.toml), spotless / google-java-format (Java), CSharpier or an
    \`.editorconfig\` next to .csproj (.NET — \`dotnet format\` reads
    editorconfig), and rubocop / standardrb (Ruby).
  `,

  remediation:
    "Add a formatter: `@biomejs/biome` or `prettier` in devDependencies (Node), `[tool.ruff.format]` in pyproject.toml (Python), or `spotless` / `CSharpier` / `rubocop` for the other ecosystems. Go and Rust get gofmt/rustfmt for free with go.mod/Cargo.toml.",

  async detect(ev) {
    if (ev.node_package.present) {
      const hasFormatterDep = NODE_FORMATTERS.some((f) => f in ev.node_package.devDependencies);
      const hasFormatScript = typeof ev.node_package.scripts.format === "string";
      if (hasFormatterDep || hasFormatScript) return { kind: "predicate", value: true };
    }

    const allPaths = ev.size_stats.files.map((f) => f.path);

    const pyManifests = allPaths.filter((p) => PY_MANIFEST.test(p) || PY_REQUIREMENTS.test(p));
    if (
      pyManifests.length > 0 &&
      (await anyMatchInFiles(pyManifests, PY_FORMAT_PATTERNS, ev.files.readText))
    ) {
      return { kind: "predicate", value: true };
    }

    if (allPaths.some((p) => GO_MOD.test(p))) return { kind: "predicate", value: true };
    if (allPaths.some((p) => RUST_MANIFEST.test(p))) return { kind: "predicate", value: true };

    const javaBuilds = allPaths.filter((p) => JAVA_BUILD.test(p));
    if (
      javaBuilds.length > 0 &&
      (await anyMatchInFiles(javaBuilds, JAVA_FORMAT_PATTERNS, ev.files.readText))
    ) {
      return { kind: "predicate", value: true };
    }

    const csprojs = allPaths.filter((p) => DOTNET_CSPROJ.test(p));
    if (csprojs.length > 0) {
      if (await anyMatchInFiles(csprojs, DOTNET_FORMAT_PATTERNS, ev.files.readText)) {
        return { kind: "predicate", value: true };
      }
      // `dotnet format` is in the SDK; an .editorconfig anchors it.
      if (ev.files.has(EDITORCONFIG)) return { kind: "predicate", value: true };
    }

    const gemfiles = allPaths.filter((p) => RUBY_GEMFILE.test(p));
    if (
      gemfiles.length > 0 &&
      (await anyMatchInFiles(gemfiles, RUBY_FORMAT_PATTERNS, ev.files.readText))
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
      name: "prettier-devdep",
      evidence: {
        node_package: { present: true, devDependencies: { prettier: "^3.0.0" } },
        size_stats: { files: [], totalBytes: 0, totalFiles: 0, source: "git-ls-files" },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "format-script-only",
      evidence: {
        node_package: { present: true, scripts: { format: "biome format --write ." } },
        size_stats: { files: [], totalBytes: 0, totalFiles: 0, source: "git-ls-files" },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "python-black-in-pyproject",
      evidence: {
        files: { "pyproject.toml": '[tool.poetry.dev-dependencies]\nblack = "^24"\n' },
        node_package: { present: false },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 1,
          files: [{ path: "pyproject.toml", bytes: 100, lines: 3, depth: 0 }],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "python-ruff-format",
      evidence: {
        files: { "pyproject.toml": "[tool.ruff.format]\nquote-style = 'double'\n" },
        node_package: { present: false },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 1,
          files: [{ path: "pyproject.toml", bytes: 100, lines: 3, depth: 0 }],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "go-mod-builtin-gofmt",
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
      name: "rust-builtin-rustfmt",
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
      name: "java-spotless",
      evidence: {
        files: { "build.gradle": "plugins { id 'com.diffplug.spotless' version '6.0.0' }" },
        node_package: { present: false },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 1,
          files: [{ path: "build.gradle", bytes: 100, lines: 3, depth: 0 }],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "dotnet-with-editorconfig",
      evidence: {
        files: {
          ".editorconfig": "[*.cs]\nindent_size = 4\n",
          "App.csproj": "<Project Sdk='Microsoft.NET.Sdk'/>",
        },
        node_package: { present: false },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 200,
          totalFiles: 2,
          files: [
            { path: ".editorconfig", bytes: 50, lines: 3, depth: 0 },
            { path: "App.csproj", bytes: 50, lines: 1, depth: 0 },
          ],
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
      name: "python-no-formatter",
      evidence: {
        files: { "pyproject.toml": "[project]\nname = 'x'\n" },
        node_package: { present: false },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 50,
          totalFiles: 1,
          files: [{ path: "pyproject.toml", bytes: 50, lines: 2, depth: 0 }],
        },
      },
      expect: { reading: { kind: "predicate", value: false }, score: 0 },
    },
  ],
});
