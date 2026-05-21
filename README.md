# repofit

Measure how agent-friendly your repo is. Score, gate, and improve.

repofit runs a corpus of **probes** against your repository — reading
files, scanning git history, executing scripts — and reduces what it
finds to a single **fitness** number plus a per-dimension breakdown.
Use it locally to spot rough edges, and in CI as a ratchet that
prevents regressions.

## Install

```bash
npx @esbenwiberg/repofit                # one-shot, no install
npm install -D @esbenwiberg/repofit     # commit to a project
```

Requires Node 22+. The CLI ships as `repofit` once installed.

## Quickstart

One-shot score:

```bash
npx @esbenwiberg/repofit
```

Wire it into a repo:

```bash
npx @esbenwiberg/repofit --init    # writes repofit.config.json
npx @esbenwiberg/repofit check --accept  # accepts current scores as repofit-baseline.json
```

Commit both files. From then on, `repofit check --ci` in CI gates against
the baseline; `repofit check --accept` ratchets it forward after intentional
improvements.

### Output modes

```bash
repofit                         # human-readable (default)
repofit --json                  # full machine-readable report
repofit --ci                    # one-line verdict + GitHub Actions annotations
repofit --html report.html      # self-contained HTML report
repofit --sarif report.sarif    # SARIF 2.1.0 for GitHub code scanning
repofit --comment body.md       # markdown body for a sticky PR comment
repofit --include executed      # also run commands (test/build/lint timings)
repofit --include reasoned      # also run LLM-judged probes
repofit check --include executed,reasoned --html repofit-report.html
                                # full scan + self-contained HTML report
repofit help                    # show common commands and examples
repofit help check              # show options for one command
```

## What it scores

Six dimensions, weighted into one fitness score:

| Dimension   | What it measures                                          |
|-------------|-----------------------------------------------------------|
| Context     | Onboarding docs, ADRs, agent guidance, README substance   |
| Consistency | Lint/format/types/test configuration, conventional commits|
| Cost        | Repo size, file depth, token estimate                     |
| Feedback    | CI runs, lint/format/types clean                          |
| Latency     | Wall-clock of test/build/lint/typecheck (opt-in tier)     |
| Safety      | Secret hygiene, dangerous script flags, branch protection |

Each probe carries its own rationale and scoring rubric. Run
`repofit explain <probe-id>` for the full story behind any reading.

## Supported stacks

repofit officially supports **Node + TypeScript**, **.NET**, **Python**, and
**Go**. For these stacks the bundled corpus auto-detects manifests and
resolves a sensible default command per phase:

| Phase     | Node                            | Python                       | .NET                                 | Go                              |
| --------- | ------------------------------- | ---------------------------- | ------------------------------------ | ------------------------------- |
| build     | `npm run build` (script)        | `python -m build`            | `dotnet build`                       | `go build ./...`                |
| test      | `npm run test:agent` / `test:unit` / `test:smoke` / `test:fast`, then safe `npm test` | `pytest`                     | `dotnet test`                        | `go test ./...`                 |
| lint      | `npm run lint` (script)         | `ruff check .`               | `dotnet format --verify-no-changes`  | `golangci-lint run` / `go vet`  |
| typecheck | `npm run typecheck` / `npx tsc` | `mypy .`                     | (built into build)                   | (built into build)              |
| format    | `npm run format[:check]`        | `ruff format --check .`      | (same tool as lint)                  | `gofmt -l .`                    |

Detection is conservative — multiple Python linters configured (e.g. ruff
and flake8) yields `n/a` rather than a wrong guess. For Node tests, repofit
will not auto-run an `npm test` script that looks like a full browser/e2e
suite (`playwright`, `cypress`, `e2e`, etc.); add `test:agent`, `test:unit`,
`test:smoke`, or `test:fast`, or opt in explicitly with a command override.
To override, set
`toolchain.commands.<phase>` in `repofit.config.json`:

```json
{
  "toolchain": {
    "commands": {
      "lint": ["sh", "-c", "npm run lint && ruff check ."]
    }
  }
}
```

**Other stacks** — repofit still runs every stack-agnostic probe (docs,
git hygiene, CI, secrets, branch protection, ADRs, file sizes). To add
probes for an unsupported stack, either declare commands in config or
publish a custom corpus package with stack-specific probes and load it
alongside the default — see [`examples/corpus-ruby/`](examples/corpus-ruby/)
for a worked example. The config takes an ordered array; later entries
override earlier ones on probe id, so a community corpus can shadow any
stock probe.

## Architecture

The engine runs probes in tiers — static → derived → historical, with
executed and reasoned tiers opt-in. The default run stays cheap and
deterministic; `--include executed` runs repository commands, and
`--include reasoned` invokes an LLM judge for qualitative checks. Each probe
emits a typed **reading** (predicate, count, magnitude, inventory,
distribution, judge, error, or n/a), which the scorer reduces to 0–100.
Probes are bundled in versioned **corpus** packages so the rubric is
reproducible.

```
packages/
  engine/          @esbenwiberg/repofit         — CLI + runtime
  corpus-default/  @esbenwiberg/corpus-default  — bundled probes
docs/
  design/                                       — durable design corpus
  adr/                                          — architecture decision records
```

The full architecture lives in [`docs/design/`](docs/design/). Point-in-time
decisions are in [`docs/adr/`](docs/adr/).

### Authoring custom probes

The default corpus covers the basics, but probes are meant to be extended.
Scaffold a new one with:

```bash
npx repofit probe new feat.my-thing            # predicate (default)
npx repofit probe new size.dead-files --kind count
npx repofit probe new latency.deploy --kind magnitude
```

See [`docs/authoring.md`](docs/authoring.md) for the full guide — tiers,
reading kinds, scoring, evidence subsystems, fixtures, and how to register
probes in a custom corpus. See [`docs/authoring-corpus.md`](docs/authoring-corpus.md)
for packaging and loading a published corpus, and
[`examples/corpus-ruby/`](examples/corpus-ruby/) for a copyable example that
adds a new probe and overrides a stock one.

## CI integrations

First-party wrappers for the common platforms:

- [GitHub Actions](integrations/github-action/) — `esbenwiberg/repofit/integrations/github-action@v1`
- [Azure DevOps Pipelines](integrations/azure-pipelines/) — step template

Both gate the PR against the committed baseline and publish the JSON + HTML
reports as build artifacts. See [`integrations/`](integrations/) for the full
list and the underlying `repofit --ci` invocation if your platform isn't
listed.

## Build

```bash
npm install
npm run typecheck   # tsc --noEmit on both packages
npm run lint        # biome check
npm run build       # emit dist/ for both packages
npm run smoke       # build the CLI and verify it starts
```

Requires Node 22+. The build is plain `tsc` on each workspace package —
no bundler.

## Development

The local loop for this CLI is:

```bash
npm install
npm run demo
npm run smoke
node packages/engine/dist/cli/index.js check --json
```

`npm run demo` builds both workspaces and runs a targeted probe against this
repo, so the CLI produces a real reading without requiring external services.
`npm run smoke` compiles the engine and runs the built CLI's `--version`
entrypoint. For probe behavior, use the fixture suite and targeted scans:

```bash
npm test
node packages/engine/dist/cli/index.js explain agent.guidance-present
node packages/engine/dist/cli/index.js check --probe agent.guidance-present --json
```

Fixtures in `packages/corpus-default/test/fixtures.test.ts` exercise every
declared probe fixture. The `examples/` packages are copyable sample data for
third-party corpus and reporter authors.

## Test

```bash
npm test            # vitest run on both packages
```

The fixture suite lives in `packages/corpus-default/test/fixtures.test.ts`
and drives every probe's declared fixtures through the engine's fixture
runner. To add a new probe, add fixtures — they double as docs and as
regression tests when scoring bands change.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for branch and commit conventions
(conventional commits enforced by `.githooks/commit-msg`). Architectural
changes that affect the SDK or the design corpus should be paired with an
ADR under [`docs/adr/`](docs/adr/).

## License

MIT
