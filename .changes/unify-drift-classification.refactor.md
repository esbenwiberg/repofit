---
type: REFACTOR
scope: cli
---

Lift drift classification (out-of-date | user-edit | missing) into a shared module used by both doctor and upgrade. Collapse upgrade's four-action union to DriftKind plus a force flag handled at apply/print time. Replace the brittle path-shape heuristic in 'upgrade [id] [path]' with id-grammar matching.
