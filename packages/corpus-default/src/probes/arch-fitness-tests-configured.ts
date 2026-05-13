import { defineProbe } from "@esbenwiberg/repofit/sdk";

const CONFIG_FILES = [
  ".dependency-cruiser.js",
  ".dependency-cruiser.cjs",
  ".dependency-cruiser.json",
  "dependency-cruiser.config.js",
  ".importrc",
  "tsarch.config.ts",
];

const NODE_TOOLS = [
  /^dependency-cruiser$/,
  /^eslint-plugin-boundaries$/,
  /^eslint-plugin-import-zones$/,
  /^@steiger\//,
  /^ts-arch$/,
  /^tsarch$/,
  /^arkit$/,
  /^madge$/,
];

const PY_REQ_PATTERNS = [/\bimport-linter\b/i, /\blint-imports\b/i, /\bpydeps\b/i];

const DOTNET_PROJECT_PATTERNS = [
  /<PackageReference\s+Include="NetArchTest(?:\.[A-Za-z]+)*"/i,
  /<PackageReference\s+Include="ArchUnitNET(?:\.[A-Za-z]+)*"/i,
];

const GO_MOD_PATTERNS = [
  /\bgithub\.com\/roblaszczak\/go-cleanarch\b/i,
  /\barchgo\b/i,
  /\bgolangci-archtest\b/i,
];

const RUST_MANIFEST_PATTERNS = [/\bcargo-modules\b/i, /\bcargo-deps\b/i];

const JAVA_BUILD_PATTERNS = [/\bcom\.tngtech\.archunit\b/i, /\barchunit-junit\d?\b/i];

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
  id: "arch.fitness-tests-configured",
  version: "1.0.0",
  dimensions: [
    { id: "consistency", weight: 1 },
    { id: "feedback", weight: 0.5 },
  ],
  tier: "derived",
  evidence: ["files", "size_stats", "node_package"],

  rationale: `
    Architecture fitness tests are unit-test-sized assertions about
    boundaries: "the ui layer must not import the db layer", "no cycles
    across packages", "this module is the only place X is allowed". They
    catch the class of regression a code review can miss and an agent will
    cheerfully introduce. This probe checks for any of the standard tools
    across the major language ecosystems — dependency-cruiser /
    eslint-plugin-boundaries / ts-arch (JS/TS), NetArchTest / ArchUnitNET
    (.NET), ArchUnit (Java), import-linter (Python), and Go arch tools.
  `,

  async detect(ev) {
    if (CONFIG_FILES.some((p) => ev.files.has(p))) {
      return { kind: "predicate", value: true };
    }

    if (ev.node_package.present) {
      const deps = {
        ...(ev.node_package.dependencies ?? {}),
        ...(ev.node_package.devDependencies ?? {}),
      };
      for (const name of Object.keys(deps)) {
        if (NODE_TOOLS.some((re) => re.test(name))) {
          return { kind: "predicate", value: true };
        }
      }
    }

    const allPaths = ev.size_stats.files.map((f) => f.path);

    const csproj = allPaths.filter((p) => /\.csproj$/i.test(p));
    if (
      csproj.length > 0 &&
      (await anyMatchInFiles(csproj, DOTNET_PROJECT_PATTERNS, ev.files.readText))
    ) {
      return { kind: "predicate", value: true };
    }

    const pyDeps = allPaths.filter((p) =>
      /(?:^|\/)(?:requirements(?:[-.][\w]+)?\.txt|pyproject\.toml|setup\.cfg|setup\.py|Pipfile)$/i.test(
        p,
      ),
    );
    if (pyDeps.length > 0 && (await anyMatchInFiles(pyDeps, PY_REQ_PATTERNS, ev.files.readText))) {
      return { kind: "predicate", value: true };
    }

    const goMod = allPaths.filter((p) => /(?:^|\/)go\.mod$/i.test(p));
    if (goMod.length > 0 && (await anyMatchInFiles(goMod, GO_MOD_PATTERNS, ev.files.readText))) {
      return { kind: "predicate", value: true };
    }

    const cargoToml = allPaths.filter((p) => /(?:^|\/)Cargo\.toml$/i.test(p));
    if (
      cargoToml.length > 0 &&
      (await anyMatchInFiles(cargoToml, RUST_MANIFEST_PATTERNS, ev.files.readText))
    ) {
      return { kind: "predicate", value: true };
    }

    const javaBuild = allPaths.filter((p) =>
      /(?:^|\/)(?:pom\.xml|build\.gradle|build\.gradle\.kts|settings\.gradle|settings\.gradle\.kts)$/i.test(
        p,
      ),
    );
    if (
      javaBuild.length > 0 &&
      (await anyMatchInFiles(javaBuild, JAVA_BUILD_PATTERNS, ev.files.readText))
    ) {
      return { kind: "predicate", value: true };
    }

    return { kind: "predicate", value: false };
  },

  score: { kind: "predicate", direction: "positive" },

  fixtures: [
    {
      name: "depcruiser-config",
      evidence: {
        files: [".dependency-cruiser.js"],
        node_package: { present: false },
        size_stats: { files: [], totalBytes: 0, totalFiles: 0, source: "git-ls-files" },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "ts-arch-dep",
      evidence: {
        files: [],
        node_package: { present: true, devDependencies: { "ts-arch": "^5" } },
        size_stats: { files: [], totalBytes: 0, totalFiles: 0, source: "git-ls-files" },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "netarchtest-in-csproj",
      evidence: {
        files: {
          "tests/Arch.Tests.csproj":
            '<Project><ItemGroup><PackageReference Include="NetArchTest.Rules" Version="1.3.2"/></ItemGroup></Project>',
        },
        node_package: { present: false },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 200,
          totalFiles: 1,
          files: [{ path: "tests/Arch.Tests.csproj", bytes: 200, lines: 5, depth: 2 }],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "archunit-in-pom",
      evidence: {
        files: {
          "pom.xml":
            "<dependency><groupId>com.tngtech.archunit</groupId><artifactId>archunit-junit5</artifactId></dependency>",
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
      name: "import-linter-in-pyproject",
      evidence: {
        files: { "pyproject.toml": '[tool.poetry.dev-dependencies]\nimport-linter = "^2"\n' },
        node_package: { present: false },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 1,
          files: [{ path: "pyproject.toml", bytes: 100, lines: 5, depth: 0 }],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "nothing-configured",
      evidence: {
        files: [],
        node_package: { present: true, scripts: {} },
        size_stats: { files: [], totalBytes: 0, totalFiles: 0, source: "git-ls-files" },
      },
      expect: { reading: { kind: "predicate", value: false }, score: 0 },
    },
  ],
});
