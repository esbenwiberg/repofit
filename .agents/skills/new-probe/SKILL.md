---
name: new-probe
description: "Use when adding or changing a probe in the default corpus: file placement, id naming, the three fixture paths, wiring, verification and dogfood. Not for engine or evidence-subsystem changes."
---
# New Probe

**Why this exists:** A probe shipped without an N/A fixture that breaks on the first repository lacking its evidence, a static probe that executes repository commands, or a reasoned probe that runs by default.

1. Add or edit one file under `packages/corpus-default/src/probes/`.
2. Keep the probe id namespaced by subject, for example `tests.oracle-quality` or `agent.skills-present`.
3. Include fixtures, in the probe file's own `fixtures` array, for at least the N/A path, the clean/pass path, and the noisy/fail path; `agentFixture` in `_shared/agent-evidence-fixture.ts` builds `agent.*` evidence from an in-memory tree.
4. Wire the probe in `packages/corpus-default/src/index.ts`.
5. Run (the engine build first: corpus tests import the SDK from `dist/`):

```bash
npm run build -w @esbenwiberg/repofit
npm --workspace @esbenwiberg/corpus-default run typecheck
npm --workspace @esbenwiberg/corpus-default test
npm run lint
```

6. Dogfood the new probe against this repo when useful:

```bash
node packages/engine/dist/cli/index.js explain <probe-id> --run
```

7. Commit with `feat(corpus): ...` unless the change is only formatting or docs.

Guardrails:
- Do not make static probes execute repo commands.
- Do not make reasoned probes run by default; keep them `tier: "reasoned"`.
- Prefer structured evidence over ad hoc filesystem reads.
