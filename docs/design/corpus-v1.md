# repofit — default corpus v1

> **Status:** draft for review. Concrete probe set across the six
> default dimensions. Companion to `dimensions.md`. Probe IDs and shapes
> are proposals; nothing locked until reviewed.

---

## 1. Overview

| Dimension | Probes (v1) | Reasoned (v1.x) | Executed (opt-in) |
|---|---|---|---|
| Context | 7 | 1 | 0 |
| Feedback | 5 | 0 | 3 |
| Consistency | 6 | 0 | 1 |
| Cost | 4 | 0 | 0 |
| Latency | 0 | 0 | 4 |
| Safety | 4 | 0 | 2 (external) |
| **Total** | **26** | **1** | **10** |

26 always-on probes. 10 opt-in (4 executed-latency + 4 executed/external in Feedback/Consistency/Safety + 1 reasoned). A working tool, not a toy; small enough to maintain.

Some probes contribute to multiple dimensions — see §9.

---

## 2. Naming convention

Probes are namespaced by *subject area*, not by dimension:

| Prefix | Subject |
|---|---|
| `agent.*` | Agent-specific guidance (CLAUDE.md, AGENTS.md, …) |
| `docs.*` | Project documentation |
| `tests.*` | Test infrastructure |
| `lint.*` | Linting |
| `format.*` | Formatting |
| `types.*` | Type checking |
| `ci.*` | CI workflows |
| `hooks.*` | Pre-commit / commit-msg hooks |
| `commits.*` | Commit message conventions |
| `secrets.*` | Secret hygiene |
| `gitignore.*` | .gitignore coverage |
| `git.*` | Repository / branch state |
| `size.*` | File / function / repo size |
| `latency.*` | Wall-clock of dev loop |
| `changelog.*` | Changelog strategy |

Coupling probes to dimensions via prefix would force renames when we move a probe between dimensions. Subject prefixes are stable.

---

## 3. Context (25%) — 7 probes + 1 reasoned

*Can the agent understand this repo on first read?*

| id | tier | evidence | reading | direction |
|---|---|---|---|---|
| `agent.guidance-present` | static | `agent_config` | predicate | positive |
| `agent.*` family | static / derived / reasoned | `agent_config`, `files`, `size_stats`, `judge` | see [corpus v2](./corpus-v2-agent-instructions.md) | mixed |
| `docs.readme-present` | static | `files` | predicate | positive |
| `docs.readme-substance` | static | `files` | count (sections) | banded |
| `docs.contributing-present` | static | `files`, `size_stats` | predicate | positive |
| `docs.adr-presence` | static | `adr_index` | count | banded |
| `docs.module-readme-coverage` | derived | `files`, `repo_meta` | magnitude (%) | banded |

**Notes:**
- The `agent.*` family (guidance presence, root budget, routing, nested guidance, adapters, skills, references, commands, portability, local settings and the reasoned rubrics) is specified in [corpus v2](./corpus-v2-agent-instructions.md) since corpus-default 2.0.0. `agent.guidance-substance` and `agent.guidance-nested` are retired there.
- `docs.readme-substance` counts presence of canonical sections (Install/Setup/Usage/Build/Test/Architecture/Contributing).
- `docs.module-readme-coverage` only counts top-level source dirs (excludes `node_modules`, `dist`, `bin`, `obj`, `.git`).
- `agent.guidance-fresh` is the killer reasoned probe — detects when CLAUDE.md claims still match reality. Reserved for v1.x.

**Recipe coverage:** 5/7 can use `fileExists`/`globCount`/`magnitudeFromContent` recipes. Two need custom detectors (`readme-substance`, `module-readme-coverage`).

---

## 4. Feedback (20%) — 5 probes + 3 executed

*Can the agent verify its own changes?*

| id | tier | evidence | reading | direction |
|---|---|---|---|---|
| `tests.runner-configured` | derived | `node_package`, `nuget`, `python_package`, `test_runner` | predicate | positive |
| `lint.configured` | derived | `node_package`, `nuget`, `lint_config` | predicate | positive |
| `types.configured` | derived | `tsconfig`, `dotnet_solution`, `python_package` | predicate | positive |
| `ci.runs-tests` | derived | `ci_workflows` | predicate | positive |
| `hooks.precommit-present` | static | `files` | predicate | positive |
| `tests.runnable` *(executed)* | executed | as above | predicate | positive |
| `lint.clean` *(executed)* | executed | as above | predicate | positive |
| `types.clean` *(executed)* | executed | as above | predicate | positive |

**Notes:**
- The pattern: a *configured* probe (static, cheap, always on) + a *clean/runnable* probe (executed, opt-in). Configured tells you the gate exists; clean tells you it actually passes.
- `tests.runner-configured` is cross-ecosystem — corpus package gates against the union of test_runner detections.
- `types.configured` is N/A on untyped repos (no TS, no .NET, no typed-Python). N/A handling means it doesn't drag Feedback down.

**Recipe coverage:** All 5 v1 probes are predicates over parsed config. `crossEcosystemPresence` recipe could cover most.

---

## 5. Consistency (15%) — 6 probes + 1 executed

*Will the agent's output blend in?*

| id | tier | evidence | reading | direction |
|---|---|---|---|---|
| `commits.conventional-followed` | historical | `commit_history` | magnitude (%) | banded |
| `commits.message-style-stable` | historical | `commit_history` | magnitude (consistency score) | banded |
| `editorconfig.present` | static | `editor_config` | predicate | positive |
| `format.configured` | derived | `node_package`, `nuget`, `lint_config` | predicate | positive |
| `gitignore.comprehensive` | derived | `gitignore` | predicate | positive |
| `changelog.strategy-declared` | static | `files` | predicate | positive |
| `format.clean` *(executed)* | executed | as above | predicate | positive |

**Notes:**
- `commits.conventional-followed` looks at last 100 commits (configurable), pattern-matches against conventional-commits regex. % conformance, banded.
- `commits.message-style-stable` is fuzzier — flags wildly inconsistent style even if not conventional (e.g. half are `feat: x` and half are `Added X`). Distinct from conformance.
- `gitignore.comprehensive` checks coverage of common bucket-patterns: env files, build artifacts, OS junk, editor state, lockfile-of-the-wrong-tool, agent caches (`.repofit/`, `.cursor/`, etc).
- `changelog.strategy-declared` accepts any of: `CHANGELOG.md`, `.changes/`, `changesets/`, `RELEASES.md`, declared release strategy in CONTRIBUTING.

**Recipe coverage:** 4/6 use recipes (editorconfig, format-configured, changelog-strategy, gitignore checks). Commit probes need custom historical detectors.

---

## 6. Cost (15%) — 4 probes

*How many tokens per task here?*

| id | tier | evidence | reading | direction |
|---|---|---|---|---|
| `size.large-files` | derived | `files`, `size_stats` | count | negative |
| `size.giant-functions` | derived | `files`, parsed source | count | negative |
| `size.directory-depth` | derived | `files` | distribution (p95) | negative |
| `size.repo-token-estimate` | derived | `files`, `gitignore` | magnitude (tokens) | negative |

**Notes:**
- `size.large-files` thresholds default to >2k LOC OR >100KB. Both gated.
- `size.giant-functions` needs ecosystem-specific parsing. v1: TS via tsc API, .NET via Roslyn-style heuristic (regex fallback). Other languages contribute via their corpus packages.
- `size.directory-depth` measures path nesting; very-deep trees hurt agent navigation.
- `size.repo-token-estimate` is a rough chars/4 over tracked files, gitignored excluded. Banded to surface "this repo will cost you" without being precise.

**Recipe coverage:** 3/4 with `globCount` / `distributionFromGlob`. Function-size needs custom parsing per ecosystem.

**Deferred:** `size.boilerplate-ratio` (detected boilerplate / total). Heuristic is hard; revisit v1.x.

---

## 7. Latency (10%) — 0 probes default, 4 executed

*How long per agent cycle?* All `executed` tier — off unless `--include executed`.

| id | tier | evidence | reading | direction |
|---|---|---|---|---|
| `latency.test-suite` | executed | `test_runner`, `node_package`, `nuget`, … | magnitude (s) | negative |
| `latency.build` | executed | ecosystem | magnitude (s) | negative |
| `latency.lint` | executed | `lint_config` | magnitude (s) | negative |
| `latency.typecheck` | executed | `tsconfig`, `dotnet_solution` | magnitude (s) | negative |

**Notes:**
- Bands target the agent-loop pain point: <10s = 100, <30s = 80, <120s = 50, >300s = 0.
- N/A handling matters: a repo with no tests yields `tests.runner-configured` failing in Feedback and `latency.test-suite` reading N/A.
- Latency probes warm caches? Open question — first-run vs steady-state. I lean *steady-state*: run twice, report second time. Adds correctness for ~2× cost.

**Recipe coverage:** All four use the same shape — `executedLatency` recipe with ecosystem-specific command resolution.

---

## 8. Safety (15%, gating) — 4 probes + 2 external

*What's the blast radius of a mistake?*

| id | tier | evidence | reading | direction |
|---|---|---|---|---|
| `secrets.dotenv-gitignored` | static | `gitignore` | predicate | positive |
| `secrets.tracked-indicators` | derived | `secrets_scan` | inventory | severity |
| `secrets.precommit-scan-configured` | derived | `files`, `ci_workflows` | predicate | positive |
| `safety.dangerous-script-flags` | static | `node_package`, `nuget`, `files`, `ci_workflows` | inventory | severity |
| `git.branch-protection` *(external)* | executed | API call to forge | predicate | positive |
| `git.code-review-required` *(external)* | executed | API call to forge | predicate | positive |

**Notes:**
- `secrets.tracked-indicators` wraps **secretlint** (Node-native, MIT, plugin-based) via a new `secrets_scan` evidence subsystem. Engine runs the scan once over tracked files, caches the result. Default rule preset: `@secretlint/secretlint-rule-preset-recommend` (AWS, GCP, GitHub, Slack, Stripe, SendGrid, npm tokens, etc.). Severity from secretlint maps to our error/warn ladder.
- `safety.dangerous-script-flags` uses our own minimal pattern set, multi-context by design (works across npm scripts, dotnet targets, Makefiles, .sh files, inline shell in CI YAML). v1 pattern set (5 patterns):

  | Pattern | Severity |
  |---|---|
  | `rm -rf /` (literal) | error |
  | `rm -rf $UNSET_VAR` (var not set in same script) | warn |
  | `curl … \| sh` / `wget … \| bash` | warn |
  | `git push --force` to default branch | warn |
  | `chmod 777` / `chmod -R 0777` | warn |

  Each finding shows location + exact match. Project waivers can suppress by file:line. Patterns documented exactly in the probe rationale. Grow set in v1.x after real-world FP/FN data.
- The two `git.*` external probes require API credentials and are off by default. They live in the schema so corpora/projects can opt in.

**Why this is gating:** Safety doesn't aggregate gracefully. A repo with one tracked secret should not score 88 because everything else is fine. The gating cap forces it visible.

**Recipe coverage:** 2/4 via predicates. Inventory probes (`tracked-indicators`, `dangerous-script-flags`) need custom detectors.

---

## 9. Cross-dimension contributions

Probes default to one dimension but may contribute to others via probe-declared weights. The default corpus uses this sparingly:

| Probe | Primary | Also contributes to | Default weights |
|---|---|---|---|
| `lint.configured` | Feedback | Consistency | Feedback: 1.0, Consistency: 0.5 |
| `format.configured` | Consistency | Feedback | Consistency: 1.0, Feedback: 0.3 |
| `commits.conventional-followed` | Consistency | Context | Consistency: 1.0, Context: 0.3 |
| `hooks.precommit-present` | Feedback | Safety | Feedback: 1.0, Safety: 0.5 |

A formatter being configured is real verification capability *and* a sign that output will fit; commit conventions matter for consistency *and* tell an agent how to phrase its own commits.

Dimensions can re-weight these in their recipes; projects can re-weight again.

---

## 10. Probe count summary

- **Always-on, default config**: 26 probes (the v1 base)
- **Add `--include executed`**: +10 probes (3 Feedback, 1 Consistency, 4 Latency, 2 Safety external)
- **Add `--include reasoned`**: the reasoned `agent.*` and docs/arch rubrics (see [corpus v2](./corpus-v2-agent-instructions.md) for the agent ones)

A first-time `repofit check` on a repo runs 26 probes, all static or derived. Should be under a second on a typical repo (evidence built once, probes share it).

---

## 11. Deferred from v1 corpus

- `size.boilerplate-ratio` — heuristic is fragile; defer to v1.x.
- Reasoned probes — shipped in v1.x; the agent rubrics were rewritten in corpus-default 2.0.0 ([corpus v2](./corpus-v2-agent-instructions.md)).
- Per-language size probes beyond TS and .NET — ship in language-specific corpus packages.
- `git.branch-protection` API plumbing — schema slot reserved, may need provider-specific impl.
- `tests.flakiness` — would need historical CI data. Out of scope.
- `dependencies.outdated` — would need network call. External tier, deferred.

---

## 12. Resolved decisions

1. **Historical N**: 100 by default, configurable in `repofit.config.json`, graceful with <100 commits (uses what's available; reading carries sample size).
2. **Latency warm-up**: probes run twice and report the second timing. Per-probe (no shared warmup across the four latency probes — isolation > speed in an opt-in tier). Tunable: `warmup: 0 | 1 | <n>`.
3. **Secret patterns**: wrap **secretlint** via a new `secrets_scan` evidence subsystem (Node-native, MIT, plugin-based). Default rule preset: `secretlint-rule-preset-recommend`. Project config can add/remove rules.
4. **Dangerous-script patterns**: roll our own minimal multi-context set (5 patterns above). Static tier, always-on. Documented exactly in the probe rationale. Project waivers can suppress by file:line. Grow in v1.x.

---

## Glossary additions

- **Cross-dimension probe** — a probe whose default declares weights in more than one dimension.
- **Configured + Clean pattern** — pairing a static "is the gate set up?" probe with an executed "does it currently pass?" probe.
