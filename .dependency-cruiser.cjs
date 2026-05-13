/**
 * dependency-cruiser config for repofit.
 *
 * Enforces the architecture rules that show up in repofit's own design:
 *   1. No circular dependencies anywhere.
 *   2. The engine is the platform — it must not depend on the corpus.
 *   3. Probes in corpus-default may only reach the engine through its
 *      public SDK (the `/sdk` subpath export); reaching into engine
 *      internals would couple the corpus to private implementation.
 *
 * Run:  npx depcruise --config .dependency-cruiser.cjs packages
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "No circular dependencies.",
      from: {},
      to: { circular: true },
    },
    {
      name: "engine-no-corpus",
      severity: "error",
      comment: "The engine is the platform; it must not depend on probe content.",
      from: { path: "^packages/engine/src" },
      to: { path: "^packages/corpus-default/src" },
    },
    {
      name: "corpus-uses-sdk-only",
      severity: "error",
      comment:
        "corpus-default may only import the engine through the public SDK (the /sdk subpath). Reaching into engine internals couples the corpus to private code.",
      from: { path: "^packages/corpus-default/src" },
      to: {
        path: "^packages/engine/src",
        pathNot: "^packages/engine/src/sdk",
      },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    doNotFollow: { path: "node_modules" },
    includeOnly: "^packages/",
    exclude: "(?:dist/|node_modules/|\\.test\\.ts$|/test/)",
  },
};
