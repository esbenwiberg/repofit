---
type: FEAT
scope: overlays
---

Wire overlays end-to-end through `add`, `upgrade`, `remove`, `doctor`, and `list`. Every command now routes through `loadMergedCatalog`, resolves `provide.source` against the entry's own `sourceRoot` (so overlay-rooted content is read from the overlay tree, not bundled `CONTENT_DIR`), and round-trips an `overlay` tag on each `LockedEntry`. `doctor` gains a new `[orphaned]` section that flags lockfile entries whose catalog id has vanished — distinguishing "overlay no longer registered" from "overlay no longer ships entry" from "no longer in bundled catalog". Tightens `DriftKind` with a per-provide `ProvideDriftKind` alias since "orphaned" is an entry-level concept that `classifyProvideDrift` never returns. Closes ADR-0004 chunks 3 + 4: full overlay plugin model with an e2e fixture covering list attribution, install, drift detection, deregistration, and remove. Shared `printOverlayLoadErrors` / `printMalformedEntries` helpers and a `pickOptionalString` typeguard collapse three duplicated warning loops and the inline overlay-string guard.
