# trim — report formats

> **Status:** concrete sketch. Defines what `trim check` and
> `trim explain` produce in each output mode. Companion to `trim.md`
> (architecture) and `config-and-baseline.md` (gate semantics).

---

## 1. Output modes

| Mode | When | Audience | CLI flag |
|---|---|---|---|
| Human (default) | Local terminal | Developer eyeballs | (none) |
| JSON | Tooling, dashboards, downstream | Machines | `--json` |
| CI | Pipeline gate | CI runner + annotations | `--ci` |
| Explain | Single probe / dimension introspection | Developer debugging the corpus | `trim explain <id>` |

Modes are mutually exclusive — `--json` and `--ci` can't combine (CI mode emits its own minimal artifact path).

**Status: agreed.**

---

## 2. Human report — example

```
trim 1.0.0  ·  corpus @<org>/corpus-default@1.0.0  ·  commit be447ba
─────────────────────────────────────────────────────────────────────

Fitness: 72  (baseline 70, +2)  ·  ratchet  ·  PASS

Dimensions
  Context      ████████░░  78   (baseline 75, +3)
  Feedback     ██████░░░░  65   (baseline 65,  =)
  Consistency  ████████░░  80   (baseline 80,  =)
  Cost         ███████░░░  70   (baseline 70,  =)
  Latency       —          (excluded; --include executed)
  Safety   ◆   █████████░  90   (baseline 90,  =)         ◆ gating

Findings  (top 5 by severity)
  ! secrets.tracked-indicators
    src/config/app.js:42  high-entropy token-like pattern (AWS-shaped)
  ! docs.adr-presence
    docs/adr/             0 ADRs found; recommend at least 3
  · docs.module-readme-coverage
    4 of 12 top-level dirs missing README.md (67%)
  · size.large-files
    src/legacy/parser.ts  2418 LOC exceeds 2000
  · hooks.precommit-present
                          no pre-commit hooks detected

26 probes ran  ·  24 pass  ·  2 fail  ·  0 n/a  ·  0 error
0 waivers active

Try:
  trim check --include executed   measure Latency + 4 more probes
  trim check --accept             lock current scores as new baseline
  trim explain docs.adr-presence  rationale + how to improve
```

### Composition

| Section | Always present | Notes |
|---|---|---|
| Header line | yes | tool version, corpus version(s), commit short SHA |
| Fitness line | yes | overall score, delta from baseline, gate mode, verdict |
| Dimensions block | yes | per-dim bar + score + delta; gating dimensions marked `◆` |
| Findings block | when any | top 5 by severity by default; `-v` shows more, `-vv` shows all |
| Probe counts | yes | one-line tally |
| Waiver count | yes | one-line; details under `-v` |
| Try-next hints | when not in CI | suggested next commands |

**Status: agreed.**

---

## 3. Visual conventions

- **Color**: green ≥ 80, yellow 50–79, red < 50. Score numbers are colored; bars use the same palette.
- **Bars**: 10-character Unicode block bars (`█` filled, `░` empty). Score / 10, rounded.
- **Delta indicators**: `+N`, `-N`, `=` (no change). N/A renders as `—`.
- **Severity glyphs**: `!` warn, `‼` error, `·` info. Plain ASCII fallback when `NO_COLOR` set or terminal lacks Unicode.
- **Width**: wraps to terminal width with sane minimum (80 columns). `--width <n>` override.
- **Verdict glyphs**: `PASS` (green) / `FAIL` (red) / `ADVISORY` (cyan).
- **Gating mark**: `◆` symbol after dimension name.

`NO_COLOR=1` strips all color, no glyphs. `--plain` forces ASCII only.

**Status: agreed.**

---

## 4. Verbosity

- (default) — top findings only, suggestions on
- `-v` / `--verbose` — every fail/error finding shown, probe-by-probe summary, waiver listing
- `-vv` / `--debug` — evidence subsystem timing, cache hit/miss, internal diagnostics
- `-q` / `--quiet` — verdict line only

CI mode defaults to quiet-with-machine-tail (see §6).

**Status: agreed.**

---

## 5. JSON output (`--json`)

Stable schema, versioned. Consumed by dashboards, custom reporters, GitHub Actions annotations.

```jsonc
{
  "$schema": "https://trim.dev/schema/report.v1.json",
  "version": 1,
  "tool": { "name": "trim", "version": "1.0.0" },
  "ranAt": "2026-05-11T14:23:00Z",
  "commit": "be447ba0...",
  "corpus": [
    { "package": "@<org>/corpus-default", "version": "1.0.0" }
  ],
  "config": { "gateMode": "ratchet", "include": ["static", "derived", "historical"] },

  "fitness": { "score": 72, "baseline": 70, "delta": 2 },
  "verdict": "pass",                      // pass | fail | advisory
  "gatedBy": null,                        // dimension id if cap triggered, else null

  "dimensions": {
    "context": {
      "score": 78, "baseline": 75, "delta": 3,
      "weight": 25, "gating": false,
      "contributingProbes": ["agent.guidance-present", "docs.readme-substance", ...]
    },
    "latency": {
      "score": null, "baseline": null, "delta": null,
      "reason": "excluded by include filter"
    }
    // ...
  },

  "probes": [
    {
      "id": "secrets.tracked-indicators",
      "version": "1.0.0",
      "tier": "derived",
      "reading": {
        "kind": "inventory",
        "items": [
          { "location": { "path": "src/config/app.js", "range": { "startLine": 42 } },
            "severity": "warn",
            "message": "high-entropy token-like pattern (AWS-shaped)" }
        ]
      },
      "score": 70,
      "baseline": 70,
      "delta": 0,
      "waived": []
    }
    // ...
  ],

  "summary": {
    "ran": 26, "pass": 24, "fail": 2, "na": 0, "error": 0,
    "activeWaivers": 0
  },

  "cost": {                              // present only when reasoned tier ran
    "llmCalls": 0,
    "tokensUsed": 0,
    "estimatedUsd": 0
  }
}
```

### Schema discipline

- `version` field at top — bumps on breaking schema change.
- All numeric scores integers 0–100.
- Locations always include `path`; `range` optional.
- Severity enum: `info | warn | error`.
- Verdict enum: `pass | fail | advisory`.
- Stable key order (alphabetical within objects) for diff-friendliness.

**Status: agreed.**

---

## 6. CI mode (`--ci`)

Minimal stdout, exit code drives the gate, optional structured artifact.

```
trim: fitness 72 (baseline 70, +2)  ratchet  PASS
```

Plus:

- Exit code: `0` pass, `1` fail, `2` engine error.
- `--artifact <path>` — also writes the full JSON report to that path. CI uploads it as a build artifact.
- GitHub Actions detection (`GITHUB_ACTIONS=true` env): emits `::warning file=…,line=…::message` and `::error file=…,line=…::message` lines for findings so they show inline on PRs.
- Azure DevOps / GitLab detection: similar adapter, schema slot reserved.

**Status: agreed.**

---

## 7. `trim explain <probe-id>` — example

```
$ trim explain agent.guidance-present

Probe       agent.guidance-present  v1.0.0
Corpus      @<org>/corpus-default@1.0.0
Tier        static  ·  Reading type: predicate
Dimensions  Context (weight 1, default)

Rationale
  An agent works dramatically better when CLAUDE.md exists and describes
  the repo's conventions. Missing CLAUDE.md is one of the strongest
  negative signals for agent fitness.

Current
  Reading:  true
  Score:    100   (baseline 100, =)

Scoring
  predicate, direction positive
  true  → 100
  false → 0

Evidence consumed
  agent_config

Fixtures (2)
  present  evidence: { files: ["CLAUDE.md"] }       expect: 100
  absent   evidence: { files: [] }                  expect: 0

To debug
  trim check --probe agent.guidance-present
```

### For reasoned-tier probes

Same body plus:

```
Reasoning
  Model         claude-sonnet-4-6
  Temperature   0
  Token budget  ~5000 (typical run)
  Samples       1 (aggregate: first)

Prompt template
  <renders the prompt with placeholder values>

Output schema
  <renders the JSON schema>

Last LLM call
  Cached at  .trim/cache/reasoned/<hash>.json
  Tokens     4823
  Cost       $0.014
```

**Status: agreed.**

---

## 8. `trim explain <dimension>` — example

```
$ trim explain context

Dimension   Context
Question    Can the agent understand this repo on first read?
Weight      25%  (overall fitness)
Gating      no
Threshold   60   (absolute-mode floor; from project config)

Current
  Score     78   (baseline 75, +3)

Contributing probes
  agent.guidance-present          weight 2.0   score 100   (default 1.0, project boost)
  agent.guidance-substance        weight 1.0   score 80
  docs.readme-present             weight 1.0   score 100
  docs.readme-substance           weight 1.0   score 60
  docs.contributing-present       weight 1.0   score 100
  docs.adr-presence               weight 1.0   score 40
  docs.module-readme-coverage     weight 1.0   score 67
  (agent.guidance-fresh)          reasoned, excluded

Aggregation
  Weighted average; n/a probes dropped; error probes surfaced but not gating.

To debug
  trim explain docs.adr-presence
  trim check --probe docs.module-readme-coverage
```

**Status: agreed.**

---

## 9. Special cases

### Gating cap triggered

```
Safety  ◆   ████░░░░░░  35   (baseline 40, -5)         ◆ gating ⚠ CAPS OVERALL
                                                       Fitness capped at 50
```

Overall fitness line:

```
Fitness: 50  (computed 72, capped by Safety<50)  ·  FAIL
```

### Probe error (engine couldn't run it)

```
× docs.module-readme-coverage  ERROR
    Could not enumerate top-level directories: permission denied (path: ./)
```

Errors surface in both human and JSON, do not contribute to scores, do not gate by default (configurable in v1.x).

### Stale baseline (probes added/removed)

```
ⓘ Baseline drift detected
  Added probes (running but not gating): agent.new-probe
  Removed probes (stale in baseline):    docs.old-thing
  Run `trim check --accept` to refresh.
```

**Status: agreed.**

---

## 10. Reporter plugin contract (deferred)

For v1, the three reporters (`human`, `json`, `ci`) are built into the engine. Plugin contract for custom reporters is deferred to v1.x — consumers of the JSON output cover most cases until then.

When added, the contract is: a reporter receives the JSON report shape (§5) and emits whatever it wants. Engine doesn't care what reporter outputs; it just runs them.

**Status: agreed (deferred).**

---

## 11. Open questions

1. **Bar character set** — Unicode block (`█░`) by default. Plain ASCII fallback (`#-` or `|.`)? I lean `#-`.
2. **Top-finding default count** — 5 in human mode. Configurable via `--top N`? Or trust verbosity flags? I lean `--top N` for power users, default 5.
3. **Color palette** — green/yellow/red is the obvious choice. Accessibility: should we also bold or underline failures so colorblind users get a second cue? I lean yes (bold the score number on fails).

---

## 12. Deferred to later versions

- SARIF reporter (slot reserved).
- Reporter plugin contract.
- HTML report mode (a-la coverage reports).
- Per-CI-vendor annotation adapters beyond GitHub Actions.
- Streaming progress output during long runs.

---

## Glossary additions

- **Verdict** — `pass | fail | advisory`. Determines exit code and report headline.
- **Delta** — change from baseline; signed integer or `=` for no change.
- **Gating cap** — when a gating dimension's score caps the overall fitness.
- **Reporter** — module that turns the JSON report into a user-facing output (human, json, ci, …).
