# @esbenwiberg/corpus-default

The default probe corpus shipped with repofit. **One probe per file.** If you
fork this for your own corpus, keep that rule — it makes the corpus
discoverable, lintable, and trivially tree-shakeable.

## Layout

| Dir | Purpose |
|---|---|
| `probes/` | One file per probe. Each `defineProbe({...})` call. Filename matches the probe id with dots replaced by dashes (e.g., `size.large-files` → `size-large-files.ts`). |
| `dimensions/` | Dimension definitions (`context`, `consistency`, `cost`, `feedback`, `latency`, `safety`). Probes reference these by id; the engine ignores unknown ids. |
| `fixers/` | Optional auto-fix planners used by `repofit apply`. Not every probe has a fixer. |
| `index.ts` | Re-exports probes and dimensions in the shape the engine's loader expects. |

## Build & test

```bash
npm run build       # tsc, depends on engine being built first
npm test            # vitest — runs every probe's declared fixtures
```

The fixture runner lives in `@esbenwiberg/repofit/fixtures`. Each probe ships
≥2 fixtures (a pass case and a fail case) — these double as docs and as
regression tests when probe scoring changes.

## Probe authoring rules

- **Read [`docs/authoring.md`](../../docs/authoring.md)** at the repo root
  before adding probes. The schema, scoring bands, and naming conventions
  matter for cross-corpus consistency.
- **A probe consumes evidence, doesn't gather it.** If you need new data,
  add a gatherer in `@esbenwiberg/repofit/evidence` first.
- **Generated files (lockfiles, `linguist-generated`) must be filtered out**
  of any cost / size analysis. Check `f.generated` on `SizeStatsFile`.
- **Remediation strings are user-facing.** Write them as advice an engineer
  can act on in 5 minutes, not a research project.

## Probe ids

Use `area.kebab-noun`: `docs.adr-presence`, `agent.nested-guidance-lean`,
`size.repo-token-estimate`. Ids are stable across versions — renaming an id
is a breaking change for downstream baselines.
