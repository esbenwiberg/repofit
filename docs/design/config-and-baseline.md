# repofit — project config and baseline

> **Status:** concrete sketch for review. Defines the two files users
> check into their repos: `repofit.config.json` (the policy / gate) and
> `repofit-baseline.json` (the ratchet snapshot). Companion to `repofit.md`
> (architecture).

---

## 1. The two files

| File | Purpose | Edited by | Where |
|---|---|---|---|
| `repofit.config.json` | Policy: corpus pinning, gate mode, thresholds, weight overrides, waivers, probe knobs | Humans, hand or via `--init` | Committed |
| `repofit-baseline.json` | Snapshot: per-probe and per-dimension scores at the moment they were accepted | `repofit check --accept` writes it | Committed |

Both files are JSON for universal tooling. Engine validates both at load.

**Status: agreed.**

---

## 2. `repofit.config.json` — full example

```jsonc
{
  "$schema": "https://repofit.dev/schema/config.v1.json",
  "version": 1,

  "corpus": [
    { "package": "@esbenwiberg/corpus-default", "version": "1.0.0" }
  ],

  "gate": {
    "mode": "ratchet",                  // "ratchet" | "absolute" | "advisory"
    "absoluteThreshold": 70,            // used when mode = absolute
    "include": ["static", "derived", "historical"]
  },

  "dimensions": {
    "context": {
      "weight": 25,
      "threshold": 60,
      "probes": {
        "agent.guidance-present": { "weight": 2 },
        "docs.adr-presence":      { "disabled": true }
      }
    },
    "safety": {
      "gating": true,
      "gatingThreshold": 50
    }
  },

  "probes": {
    "commits.conventional-followed": { "sampleSize": 100 },
    "latency.test-suite":            { "warmup": 1 },
    "secrets.tracked-indicators":    {
      "secretlintRules": ["@secretlint/secretlint-rule-preset-recommend"]
    }
  },

  "waivers": [
    {
      "probeId": "secrets.tracked-indicators",
      "location": "tests/fixtures/sample-token.txt",
      "reason": "Test fixture, not a real credential",
      "expires": "2026-12-01"
    }
  ],

  "reporters": {
    "default": "human"                  // "human" | "json"
  },

  "llm": {
    "provider": "anthropic",            // for reasoned tier (v1.x)
    "apiKeyEnv": "ANTHROPIC_API_KEY"
  }
}
```

**Status: tentative — section-by-section walkthrough below.**

---

## 3. `corpus` — pinning the probe set

Array, because a project may layer multiple corpus packages (default + .NET-specific + a private internal corpus).

```jsonc
"corpus": [
  { "package": "@esbenwiberg/corpus-default", "version": "1.0.0" },
  { "package": "@esbenwiberg/corpus-dotnet",  "version": "0.4.2" }
]
```

- **Exact versions only**, like a lockfile. No semver ranges. Reproducibility > convenience.
- Conflicts (same probe ID in multiple corpora) → engine errors at load. Resolve by `disabled: true` on one side.
- `repofit corpus upgrade` deferred — for now, manual edit.

**Status: agreed.**

---

## 4. `gate` — what counts as pass/fail

```jsonc
"gate": {
  "mode": "ratchet",           // ratchet | absolute | advisory
  "absoluteThreshold": 70,     // used only when mode = absolute
  "include": ["static", "derived", "historical"]
}
```

**Modes:**
- `ratchet` — `fitness >= baseline` per dimension. PR fails if any dimension regresses.
- `absolute` — `fitness >= absoluteThreshold` overall + per-dimension `threshold` if set.
- `advisory` — never fails, just reports. Useful during adoption.

**`include`** — which probe tiers to run, plus any opt-in probes by id. Defaults to all non-opt-in tiers (`static`, `derived`, `historical`). To enable executed: add `"executed"`. To enable reasoned: add `"reasoned"`. A probe that declares `optIn: true` (for example `agent.skill-evals-present`) runs only when its id is listed here or passed on the command line, and only when its tier is also included; `--probe <id>` counts as opting in.

CI typically uses the project default. Local exploration: `repofit check --include executed`.

**Status: agreed.**

---

## 5. `dimensions` — overrides on the corpus defaults

Three layers of weight precedence (locked earlier): probe → dimension recipe → project config. This is the project layer.

```jsonc
"dimensions": {
  "context": {
    "weight": 25,                    // override the corpus dimension weight
    "threshold": 60,                 // absolute-mode per-dimension floor
    "probes": {
      "agent.guidance-present": { "weight": 2 },           // boost
      "docs.adr-presence":      { "disabled": true }       // exclude
    }
  },
  "safety": {
    "gating": true,                  // make gating (default true for Safety)
    "gatingThreshold": 50            // cap overall at this if Safety < threshold
  }
}
```

Per-probe options within a dimension:
- `weight` — re-weight contribution
- `disabled` — exclude from this dimension's aggregation
- `severity` — coming in v1.x (e.g. promote a warn to error)

Per-dimension options:
- `weight` — override the corpus-level weight in overall fitness
- `threshold` — for absolute mode, per-dimension floor
- `gating` / `gatingThreshold` — promote a dimension to gating

**Status: agreed.**

---

## 6. `probes` — probe-specific knobs

Knobs probes themselves declare in their schema. Engine validates names and types against the loaded probe.

```jsonc
"probes": {
  "commits.conventional-followed": { "sampleSize": 100 },
  "latency.test-suite":            { "warmup": 1 },
  "size.large-files":              { "locThreshold": 2000, "byteThreshold": 102400 }
}
```

Each probe declares its supported knobs and defaults in its `defineProbe()` config block. Unknown knobs at load → error.

**Status: agreed.**

---

## 7. `waivers` — accepting specific findings

```jsonc
"waivers": [
  {
    "probeId": "secrets.tracked-indicators",
    "location": "tests/fixtures/sample-token.txt",
    "reason": "Test fixture, not a real credential",
    "expires": "2026-12-01"
  }
]
```

- **Identification**: `probeId` + `location` (path optionally with `:line`). The waiver suppresses that specific finding.
- **Reason required.** Empty reasons forbidden. Forces minimal accountability.
- **Optional `expires`** — ISO 8601 date. Engine warns when within 30 days of expiry, errors on overdue waivers. Forces periodic review.
- Waivers apply to *inventory* findings primarily. For predicate/count probes, use `disabled: true` in a dimension override instead.

**Status: tentative — see open question on identification method.**

---

## 8. `reporters` and `llm`

```jsonc
"reporters": {
  "default": "human"     // human | json
}
```

`--json` / `--human` CLI flags override. SARIF reserved for v1.x.

```jsonc
"llm": {
  "provider": "auto",                  // auto | anthropic | claude-code | openai | local
  "apiKeyEnv": "ANTHROPIC_API_KEY",    // used when provider resolves to anthropic
  "baseUrl": "https://..."             // optional; for self-hosted / proxy
}
```

Reasoned tier (v1.x). Providers:

- **`anthropic`** — direct API; reads key from env (`apiKeyEnv`). Never literal key in config.
- **`claude-code`** — when repofit runs inside a Claude Code session, reuse the session's auth/transport via the Claude Agent SDK. No separate API key needed; cost is billed to the host session. Detect via env (`CLAUDECODE=1` or similar) when explicit, or auto.
- **`openai`** / **`local`** — slots reserved.
- **`auto`** (default) — prefer `claude-code` if detected, else fall back to `anthropic` via env. Lets a CI run the same config that a developer uses inside Claude Code.

Exact `claude-code` transport (SDK call vs IPC vs MCP-style bridge) is a v1.x implementation detail; the schema reservation is the v1 commitment.

**Status: agreed.**

---

## 9. `repofit-baseline.json` — full example

```jsonc
{
  "$schema": "https://repofit.dev/schema/baseline.v1.json",
  "version": 1,

  "acceptedAt": "2026-05-11T14:23:00Z",
  "acceptedBy": "user@example.com",
  "commit": "be447ba0...",

  "corpus": [
    { "package": "@esbenwiberg/corpus-default", "version": "1.0.0" }
  ],

  "fitness": 72,

  "dimensions": {
    "context":     78,
    "feedback":    65,
    "consistency": 80,
    "cost":        70,
    "latency":     null,
    "safety":      90
  },

  "probes": {
    "agent.guidance-present":          100,
    "agent.root-budget":                80,
    "docs.contributing-present":       100,
    "docs.adr-presence":                40,
    "docs.module-readme-coverage":      67,
    "docs.readme-present":             100,
    "docs.readme-substance":            60,
    "tests.runner-configured":         100,
    "lint.configured":                 100,
    "types.configured":                100,
    "ci.runs-tests":                   100,
    "hooks.precommit-present":           0,
    "commits.conventional-followed":    85,
    "commits.message-style-stable":     90,
    "editorconfig.present":            100,
    "format.configured":               100,
    "gitignore.comprehensive":         100,
    "changelog.strategy-declared":     100,
    "size.large-files":                 80,
    "size.giant-functions":             90,
    "size.directory-depth":            100,
    "size.repo-token-estimate":         70,
    "secrets.dotenv-gitignored":       100,
    "secrets.tracked-indicators":      100,
    "secrets.precommit-scan-configured": 0,
    "safety.dangerous-script-flags":   100
  }
}
```

**Why both per-probe and per-dimension scores?**
- Per-dimension is what ratchet gates against — small, stable, the actual policy surface.
- Per-probe is for explanation: when a dimension drops, the per-probe diff tells you *which* probe regressed. Reviewer-friendly.

**Why `latency: null`?** Latency probes are opt-in (executed tier). When excluded by `gate.include`, the dimension has no readings to aggregate. Distinguishes "didn't measure" from "scored zero."

**Status: tentative — see open question on diff-friendliness.**

---

## 10. How `--accept` works

```bash
repofit check --accept
```

1. Run probes per the project config.
2. Compute readings, scores, dimensions, fitness.
3. **Write `repofit-baseline.json`** with the current snapshot.
4. Print summary: "Baseline updated. fitness: 70 → 72."

If the run would have failed under the current baseline, `--accept` still writes — the user is explicitly accepting the new state. (Optional `--accept --confirm` flag if we want a guard.)

**Required: clean git working tree** (or `--accept --dirty`). Prevents accidental baselines mixed with WIP.

**Status: agreed.**

---

## 11. Baseline / corpus drift handling

Three scenarios:

**Probe added to corpus**
- New probe runs, scores, reports — but **does not gate** until baseline includes it.
- `repofit check` prints: "New probe(s) found: agent.foo. Run --accept to baseline."

**Probe removed from corpus**
- Baseline entry becomes stale. Engine ignores it; warns: "Stale baseline entries: agent.bar (probe removed). Run --accept to clean up."

**Corpus version changes**
- Baseline records corpus versions. On mismatch:
  - **Patch / minor diff** — engine accepts, but warns if any probe-version skewed.
  - **Major diff** — error. Force explicit `--accept` after review.
- Reading: corpus upgrades are treated like dep upgrades (intentional acts).

**Probe-version bumps** (within same corpus version)
- A score-affecting bump is, by our discipline, also a corpus-version bump. So this is rare and handled above.

**Status: agreed.**

---

## 12. Lifecycle — first run to steady state

Day 0 (greenfield adoption):

```bash
$ repofit check
# No config found. Running with defaults (advisory).
# fitness: 64
# (Run `repofit check --init` to commit a config.)
```

Day 1:

```bash
$ repofit check --init
# Writing repofit.config.json (corpus pinned at @esbenwiberg/corpus-default@1.0.0).
# Gate mode: advisory (until you set a baseline).
# (Run `repofit check --accept` to set the baseline and enable ratchet.)

$ repofit check --accept
# Writing repofit-baseline.json. fitness: 64.
# Gate mode now: ratchet.
```

Day 2+:

```bash
$ repofit check                       # CI gates against baseline
$ repofit check --include executed    # local: run the slow stuff too
$ repofit check --include agent.skill-evals-present   # one opt-in probe by id
$ repofit check --accept              # after improvement, lock new score
```

Eventually:

```jsonc
// repofit.config.json
"gate": { "mode": "absolute", "absoluteThreshold": 75 }
```

— team has graduated from ratchet to a real fitness target.

**Status: agreed.**

---

## 13. Config validation at load

Engine validates `repofit.config.json` against its schema. Failures are pointed errors (path + line). Examples:

- Unknown `gate.mode`
- `corpus[].version` not pinned (semver range used)
- Dimension references a probe id not present in any loaded corpus
- Probe knob name not declared by the probe schema
- Waiver with no `reason`
- Expired waiver (warning, not error)

Same discipline for the baseline file — JSON schema validation, fail loud.

**Status: agreed.**

---

## 14. Resolved decisions

1. **Waiver identification**: `probeId + location` only in v1. Brittle under line shifts; document the limitation. Add `findingHash` in v1.x for content-stable matching.
2. **Baseline granularity**: store **both** per-dimension scores (the gate) and per-probe scores (the explanation). ~30 extra lines for the default corpus; diff-readable.
3. **Init surface**: `repofit check --init` flag, not a separate verb. Keeps verb count at three.
4. **Multiple corpora**: **last-wins with a load-time warning** when two corpus packages define the same dimension recipe. Mirrors layered config conventions.
5. **LLM credentials**: env-only for literal keys (`apiKeyEnv` points to env var; never `apiKey` in the file). `provider: "claude-code"` reuses the host Claude Code session's auth via the Claude Agent SDK, billed to that session. `provider: "auto"` prefers claude-code when detected, falls back to anthropic via env.

---

## 15. Deferred to later versions

- `repofit corpus upgrade` automation (v1: manual edit of the version pin).
- SARIF reporter (slot reserved).
- Finding-hash-based waiver matching (v1: location-only).
- Per-probe severity promotion in dimension overrides (v1.x).
- `claude-code` LLM provider transport mechanism (Claude Agent SDK call vs IPC vs MCP bridge); schema slot reserved in v1.
- `openai`, `local`, and other LLM provider implementations (slots reserved).

---

## Glossary additions

- **Gate mode** — `ratchet` (no regression) / `absolute` (meet threshold) / `advisory` (report only).
- **Waiver** — entry that suppresses a specific finding from a specific probe at a specific location, with a required reason and optional expiry.
- **Bootstrap flow** — first-run progression: defaults → `--init` writes config → `--accept` writes baseline → CI gates.
