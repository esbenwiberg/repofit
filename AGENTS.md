# Working on repofit

repofit is a CLI that measures how agent-friendly a repository is: a corpus
of **probes** emits **readings**, each is scored, scores aggregate per
**dimension** into one fitness number, and gates make it usable in CI. Read
this file, then the skill or document the task routes to.

## Start here

```bash
npm install
npm run typecheck      # tsc --noEmit on every workspace
npm run lint           # biome check
npm run build          # emit dist/ (corpus tests import the engine's dist)
npm test               # vitest run on every workspace
node packages/engine/dist/cli/index.js --version
```

Node 22+, TypeScript strict ESM (NodeNext), npm workspaces. Build the engine
before running corpus tests: they import `@esbenwiberg/repofit/sdk` from
`dist/`.

## Layout

```
packages/engine/         @esbenwiberg/repofit          CLI + runtime
  src/cli/ sdk/ evidence/ loader/ runner/ scorer/ aggregator/ reporters/
packages/corpus-default/ @esbenwiberg/corpus-default   bundled probes
  src/probes/ (one file per probe)  src/dimensions/
docs/design/             design corpus; read before changing architecture
docs/release/            one note per release (no CHANGELOG.md)
docs/research/           field studies the corpus is grounded in
examples/ integrations/ specs/   sample configs, CI integrations, schemas
.agents/skills/          repository skills; .claude/skills links here
```

## Task routes

| Task | Use |
|---|---|
| Add or change a probe | `/new-probe` skill, then [authoring](docs/authoring.md) and [probe schema](docs/design/probe-schema.md) |
| Commit | `/commit` skill |
| Run repofit on this repository | `/dogfood-scan` skill |
| Release a package | `/release` skill, notes under [docs/release/](docs/release/) |
| Custom corpus or reporter | [authoring-corpus](docs/authoring-corpus.md), [authoring-reporter](docs/authoring-reporter.md) |
| Change config, baseline or report shape | [config and baseline](docs/design/config-and-baseline.md), [reports](docs/design/reports.md) |
| Change dimensions or the corpus plan | [dimensions](docs/design/dimensions.md), [corpus v1](docs/design/corpus-v1.md), [corpus v2 agent instructions](docs/design/corpus-v2-agent-instructions.md) |
| Decide something lasting | an ADR under [docs/adr/](docs/adr/) |

## Always / Ask first / Never

- **Always** run the changed workspace's typecheck and tests plus `npm run
  lint` before committing; commit as `type(scope): subject` (enforced by
  `.githooks/commit-msg`, installed by `.githooks/install-hooks.sh`); stage
  only your own files; write release notes under `docs/release/`.
- **Ask first** before publishing to npm, accepting a new baseline
  (`repofit check --accept`), changing a probe's id or scoring bands, or
  running the reasoned tier against a repository that is not this one.
- **Never** use `--no-verify`, commit secrets or `.repofit/` cache and report
  artifacts, make a static probe execute repository commands, run reasoned
  probes by default, or weaken a fixture to make it pass.

## Conventions

- Probe ids are namespaced by subject (`tests.oracle-quality`,
  `agent.skills-present`); every probe ships N/A, pass and fail fixtures.
- Prefer structured evidence subsystems over ad hoc filesystem reads.
- Corpus pins in `repofit.config.json` are exact versions, never ranges.
- License MIT; packages publish under the `@esbenwiberg` npm scope.

## What belongs here

This file routes. A rule that applies to one workflow goes in its skill; a
rule that applies to one package goes in that package's guide; rationale goes
in a design doc or ADR. Add a line here only when every task needs it.
