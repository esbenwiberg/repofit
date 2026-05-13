# repofit

> **Status:** v1.0.0 — initial release. CLI, default corpus, and dogfood gate
> are all wired. Release notes: [`docs/release/v1.0.0.md`](docs/release/v1.0.0.md).

A CLI that measures how agent-friendly a repo is. The engine runs a corpus of
**probes** that emit **readings**, scores each reading, aggregates per
**dimension**, and produces an overall fitness number. Optional gates (ratchet,
absolute, advisory) make it usable in CI.

## Architecture

npm workspaces monorepo. **Node 22+**, **TypeScript** (strict, ESM, NodeNext).

```
packages/
  engine/          @esbenwiberg/repofit          — CLI + runtime
    src/
      cli/         entrypoints
      sdk/         public API (defineProbe, defineDimension, recipes)
      evidence/    subsystem registry + gatherers
      loader/      config + corpus + baseline loaders
      runner/      tier scheduler, probe execution
      scorer/      reading → score
      aggregator/  probe → dim → fitness
      reporters/   human / json / ci
  corpus-default/  @esbenwiberg/corpus-default   — bundled probes
    src/
      probes/      one file per probe
      dimensions/  dimension definitions
docs/
  design/          design corpus (read this before changing the design)
```

## Build & Test

```bash
npm install
npm run typecheck      # tsc --noEmit on both packages
npm run lint           # biome check
npm run build          # emit dist/ for both packages
npm test               # vitest run on both packages
```

CLI smoke test once built:

```bash
node packages/engine/dist/cli/index.js --version    # → repofit 1.0.0
```

## Key Conventions

- **Commits:** `type(scope): subject` (feat, fix, docs, style, refactor, perf,
  test, build, ci, chore, breaking, security). Enforced by
  `.githooks/commit-msg`. Wire hooks via `.githooks/install-hooks.sh`.
- **Pre-commit:** `.githooks/pre-commit` runs a secret scan.
- **No `--no-verify`.** Fix the underlying issue.
- **No `CHANGELOG.md` discipline.** Release notes are written per-release
  under [`docs/release/`](docs/release/).
- **License:** MIT.
- **npm scope:** `@esbenwiberg` (packages publish as `@esbenwiberg/repofit`
  and `@esbenwiberg/corpus-default`).

## Where to find things

| What | Where |
|---|---|
| Authoring custom probes (start here for extending the corpus) | [`docs/authoring.md`](docs/authoring.md) |
| Design corpus (read before changing the architecture) | [`docs/design/`](docs/design/) — start with `README.md` |
| Release notes | [`docs/release/`](docs/release/) |
| Implementation plan (phases 0 → 7, now complete) | [`docs/design/implementation-plan.md`](docs/design/implementation-plan.md) |
| Probe schema | [`docs/design/probe-schema.md`](docs/design/probe-schema.md) |
| Report formats | [`docs/design/reports.md`](docs/design/reports.md) |
| Config + baseline | [`docs/design/config-and-baseline.md`](docs/design/config-and-baseline.md) |
| Dimensions + corpus v1 | [`docs/design/dimensions.md`](docs/design/dimensions.md), [`docs/design/corpus-v1.md`](docs/design/corpus-v1.md) |
