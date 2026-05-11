# repofit

> **Status:** Phase 0 scaffold. The agentry codebase that previously lived here
> has been removed; this repo now hosts repofit (the successor architecture
> described in [`docs/design/`](docs/design/)). Coding is in early bring-up —
> packages exist, but verbs are not implemented yet.

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
      sdk/         public API (defineProbe, defineDimension, recipes) — Phase 1
      evidence/    subsystem registry + gatherers                     — Phase 1
      loader/      config + corpus + baseline loaders                 — Phase 1+
      runner/      tier scheduler, probe execution                    — Phase 1+
      scorer/      reading → score                                    — Phase 1+
      aggregator/  probe → dim → fitness                              — Phase 1+
      reporters/   human / json / ci                                  — Phase 1+
  corpus-default/  @esbenwiberg/corpus-default   — bundled probes
    src/
      probes/      one file per probe                                 — Phase 1+
      dimensions/  dimension definitions                              — Phase 1+
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
node packages/engine/dist/cli/index.js --version    # → repofit 0.0.0
```

## Key Conventions

- **Commits:** `type(scope): subject` (feat, fix, docs, style, refactor, perf,
  test, build, ci, chore, breaking, security). Enforced by
  `.githooks/commit-msg`. Wire hooks via `.githooks/install-hooks.sh`.
- **Pre-commit:** `.githooks/pre-commit` runs a secret scan.
- **No `--no-verify`.** Fix the underlying issue.
- **No `CHANGELOG.md` discipline.** The agentry-era `.changes/` fragment system
  was removed; release notes will be written manually at v1 ship time.
- **License:** MIT.
- **npm scope:** `@esbenwiberg` (packages publish as `@esbenwiberg/repofit`
  and `@esbenwiberg/corpus-default`).

## Where to find things

| What | Where |
|---|---|
| Design corpus (read before changing the architecture) | [`docs/design/`](docs/design/) — start with `README.md` |
| Implementation plan (phases 0 → 7) | [`docs/design/implementation-plan.md`](docs/design/implementation-plan.md) |
| Probe schema | [`docs/design/probe-schema.md`](docs/design/probe-schema.md) |
| Report formats | [`docs/design/reports.md`](docs/design/reports.md) |
| Config + baseline | [`docs/design/config-and-baseline.md`](docs/design/config-and-baseline.md) |
| Dimensions + corpus v1 | [`docs/design/dimensions.md`](docs/design/dimensions.md), [`docs/design/corpus-v1.md`](docs/design/corpus-v1.md) |
