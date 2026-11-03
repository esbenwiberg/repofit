# Architecture Decision Records

Each ADR captures one decision: the context, the options, what was chosen, and
why. Format follows [Nygard's
template](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

ADRs are numbered, immutable once accepted, and superseded by writing a new one
that points back. Don't edit history — explain how it changed.

## Index

| # | Title | Status |
|---|---|---|
| [0001](./0001-adopt-npm-workspaces.md) | Adopt npm workspaces over pnpm/turbo | Accepted |
| [0002](./0002-split-engine-and-corpus.md) | Split engine and default corpus into separate packages | Accepted |
| [0003](./0003-evidence-subsystem-registry.md) | Evidence subsystem registry as the gather-and-cache primitive | Accepted |
| [0004](./0004-ratchet-baseline-default-gate.md) | Ratchet baseline as the default gate mode | Accepted |
| [0005](./0005-corpus-pinning-in-baseline.md) | Pin corpus name and version inside the baseline | Accepted |
| [0006](./0006-exclude-generated-files-from-cost.md) | Exclude generated files from cost-dimension probes | Accepted |
| [0007](./0007-thin-routed-agent-instructions.md) | Score agent instructions as thin, routed and deterministic first | Accepted |

## When to write an ADR

Write one when a decision will affect future contributors and the "why" isn't
self-evident from the code. Skip ADRs for tactical choices, naming bikesheds,
and anything that gets re-litigated weekly.

A useful test: "if someone tries to undo this in six months, what would I want
them to read first?" — if the answer is a comment, write a comment. If the
answer is a paragraph with tradeoffs, write an ADR.
