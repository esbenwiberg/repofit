---
type: REFACTOR
scope: cli
---

Refactor add's dep prompt into an explicit three-state decision (skip/ask/auto-install), unify the two 'depends on X — not installing' warnings into a single helper, print a 'resolving plan for X' header before deps are processed so warnings are not orphaned, and document the non-interactive policy ('pick the safe default per prompt').
