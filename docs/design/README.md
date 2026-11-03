# repofit — design corpus

> **Status:** current architectural memory for repofit (engine 1.3, corpus-default 2.0). The original
> design work has shipped; docs in this folder are maintained as living design
> notes, while final project decisions are captured in [`docs/adr/`](../adr/).

This folder is the durable design corpus for the repo. It records the system
shape behind the current npm workspaces implementation:

- `packages/engine` owns the CLI, loaders, evidence gatherers, runner, scorer,
  aggregator, verdict logic, reporters, and public SDK.
- `packages/corpus-default` owns bundled dimensions, probes, and fixers. It
  consumes only public engine APIs.
- `docs/adr` owns accepted architectural decisions. Use ADRs for decisions that
  constrain future changes; use this folder for mutable explanatory design.
- `examples` and `integrations` demonstrate extension points and CI wrappers;
  they should not import engine internals.

The main dependency rule is one-way: the engine is probe-agnostic, corpus
packages depend on the engine SDK, and examples/integrations sit at the edge.
Do not move stock probes into the engine or make the engine depend on
`corpus-default`.

Eight documents own one concern each; cross-linked where needed. Research that grounds a design lives in [`docs/research/`](../research/).

---

## Reading order

For a first-time reader, work top to bottom — each doc assumes the
previous ones.

| # | Doc | What it locks |
|---|---|---|
| 1 | [`repofit.md`](./repofit.md) | Architecture overview. Three-layer model (engine / probes / evidence). Verbs. Tiers. Reasoned-tier framing. Remediation slot reservation. |
| 2 | [`probe-schema.md`](./probe-schema.md) | Probe authoring contract: `defineProbe()`, five reading types, scoring config shapes, declarative recipes, weight precedence, async detectors. |
| 3 | [`dimensions.md`](./dimensions.md) | The six default dimensions and their weights. Context (25%) / Feedback (20%) / Consistency (15%) / Cost (15%) / Latency (10%) / Safety (15%, gating). |
| 4 | [`corpus-v1.md`](./corpus-v1.md) | Default corpus v1: 26 always-on probes + 10 opt-in + 1 reasoned-for-v1.x. Probe IDs, naming convention, recipe-vs-custom coverage. |
| 5 | [`config-and-baseline.md`](./config-and-baseline.md) | `repofit.config.json` (the policy gate) and `repofit-baseline.json` (the ratchet snapshot). Corpus pinning, gate modes, dimension/probe overrides, waivers, bootstrap flow, `claude-code` LLM provider. |
| 6 | [`reports.md`](./reports.md) | Output formats: human (default) / `--json` / `--ci` / `repofit explain`. Visual conventions. Gating-cap rendering. GitHub Actions annotations. |
| 7 | [`implementation-plan.md`](./implementation-plan.md) | Seven-phase build sequence from skeleton to v1.0.0 release. Tech stack: Node 22, TS strict, vitest, biome, commander, MIT, npm scope `@esbenwiberg`. |
| 8 | [`corpus-v2-agent-instructions.md`](./corpus-v2-agent-instructions.md) | Default corpus v2 for the `agent.*` family: deterministic-first probes for routing, copies, blind references, undefined commands and committed local settings; additive `agent_config` evidence (symlinks, nested files, skills, harness settings); reasoned rubrics and judge defaults. Grounded in the [agent-instructions field study](../research/agent-instructions-field-study-2026-11.md). |

---

## Status of the design

The v1 architecture has shipped. Some individual documents still preserve
draft-era phrasing and open questions for historical context, so prefer the
newer ADRs and release notes when there is a conflict.

Current invariants:

- `packages/engine/src/sdk` is the public API. Changes there affect third-party
  corpus and reporter authors.
- Evidence gatherers live in the engine and are reusable; probes consume cached
  evidence instead of doing their own filesystem or process discovery.
- Probe IDs are stable contracts. Rename only with a breaking release.
- Generated or vendored files should be excluded from cost probes with
  `.gitattributes linguist-generated=true` or built-in generated-file handling.
- Ratchet baselines are committed policy artifacts. Update them only after an
  intentional scan change or repo improvement.

---

## Relationship to agentry

repofit began as a successor architecture to agentry's
scan/brief/add/upgrade/remove/coach/list model. The successor now exists as
this repository: repofit measures repository fitness against a probe corpus and
gates on score.

---

## How to evolve this folder

These docs are working design notes, not ADRs. They are expected to change as
decisions are revisited.

- **Update in place** when a decision firms up — mark `Status:
  agreed`. Don't preserve dead phrasing for history; git keeps that.
- **Open questions** sections at the bottom of each doc are where new
  uncertainty lands.
- **When a decision is finally locked** by the project (not just by
  the design conversation), copy it into a numbered ADR under
  `../adr/`. Design docs are mutable; ADRs are not.
