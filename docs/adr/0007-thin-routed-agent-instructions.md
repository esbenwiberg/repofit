# 0007 — Score agent instructions as thin, routed and deterministic first

- **Status:** Accepted
- **Date:** 2026-11-03

## Context

The v1 `agent.*` probes rewarded volume: `agent.guidance-substance` banded
root line counts upward to 200 lines, `agent.guidance-nested` wanted a
guidance file in every package, and the reasoned probes judged content the
deterministic probes could have measured. A field study of 55 open-source
repositories ([docs/research/](../research/)) found the opposite shape in the
repositories that work well with agents: a root under about 6 KB that routes
to deeper files, nested guidance only where priorities differ from the root,
one source for skills with harness directories linking to it, and references
and commands that resolve. The anti-patterns were monolith roots, copied
adapters, stub nesting and blind pointers.

Two ways to encode that were open:

1. Keep the ids, retune the bands, and let the judge weigh the rest.
2. Retire the ids whose meaning inverts, add deterministic probes for
   everything a file system can measure, and narrow the judge to what only
   reading can tell.

## Decision

Option 2, as the [corpus v2 design](../design/corpus-v2-agent-instructions.md)
specifies:

- **Deterministic first.** Size, routing, nesting, adapters, skill sources,
  trigger lines, references, commands, portability and committed local
  settings are measured from tracked files. Each probe returns `na` when the
  repository has nothing to measure, so the family is advisory where it does
  not apply.
- **The judge scores substance only.** Rubrics state what the deterministic
  probes already covered and the input carries those facts, so the model is
  not asked to re-measure them.
- **Thin and routed is the default opinion, with an escape hatch.** The root
  budget bands at 6/12/24/48 KB; a repository that needs a larger root waives
  the probe with a reason rather than arguing with the band.
- **Ids that invert are retired, not retuned.** A score that meant "more is
  better" cannot keep its id when it starts meaning the reverse. The corpus
  records retired ids with their replacements and the engine warns when a
  config still names one. Under ADR-0005 the baseline pins the corpus
  version, so the change is a corpus major and users re-accept.
- **Judge defaults track the current small models** (`claude-haiku-5-5`,
  `gpt-5.4-mini`) because the narrowed rubrics need reading, not reasoning
  depth, and the cache keys on the model.

## Consequences

- Context scores move for every repository on upgrade. Repositories with
  copies, blind references or undefined commands drop; that is the intended
  signal, and the release note says so.
- The deterministic family depends on the engine's `agent_config` evidence
  v2, which couples corpus-default 2.x to engine 1.3+.
- repofit's own layout had to meet the opinion: skills moved to
  `.agents/skills` with `.claude/skills` linking to it, and the root became a
  routing file. Dogfood scores are the first evidence the bands are sane.
- A future study that contradicts the thin-root finding should supersede this
  ADR rather than retune the bands in place.
