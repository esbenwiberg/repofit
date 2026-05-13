# Authoring custom probes

`repofit` ships with a [default corpus](../packages/corpus-default/) of ~45
probes, but the framework is meant to be extended. This guide walks through
authoring your own probes for a custom corpus.

## When to write a custom probe

Write one when:

- Your project (or company) has a convention that isn't generic
  — house-style guidance files, in-repo runbooks, license-header rules,
  data-pipeline lineage, internal CI shapes.
- The default corpus's signal is too coarse for a specific class of mistake
  you've seen agents make.
- You want a measurable gate on something nobody else cares about — that's
  exactly the use case for a corpus you own.

If the probe is generally useful and reusable across projects, consider
opening a PR against [`@esbenwiberg/corpus-default`](../packages/corpus-default/)
instead.

## Scaffold

```bash
# scaffold a new predicate probe into ./probes/feat-my-thing.ts
npx repofit probe new feat.my-thing

# or pick a different reading kind
npx repofit probe new size.dead-files --kind count
npx repofit probe new latency.deploy --kind magnitude

# or write into a custom directory
npx repofit probe new feat.my-thing --dir packages/my-corpus/src/probes
```

The scaffold gives you a probe with the required fields wired up
(`id`, `version`, `dimensions`, `tier`, `evidence`, `rationale`,
`remediation`, `detect`, `score`, `fixtures`) plus inline comments
explaining each. You fill in the body.

## Probe anatomy

Every probe is built with `defineProbe(...)`:

```ts
import { defineProbe } from "@esbenwiberg/repofit/sdk";

export default defineProbe({
  id: "feat.my-thing",
  version: "0.1.0",
  dimensions: [{ id: "consistency", weight: 1 }],
  tier: "static",
  evidence: ["files"],

  rationale: `Why this signal matters to an agent.`,
  remediation: "Concrete steps to fix when the probe fails.",

  async detect(ev) {
    return { kind: "predicate", value: ev.files.has("EXAMPLE.md") };
  },

  score: { kind: "predicate", direction: "positive" },

  fixtures: [
    {
      name: "present",
      evidence: { files: ["EXAMPLE.md"] },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
  ],
});
```

### Required fields

| Field         | What it does                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `id`          | Stable identifier. Use `category.what-it-checks` (lowercase, kebab-case segments, dot-separated).                              |
| `version`     | Semver. Bump on rubric/scoring changes — invalidates the judge cache for reasoned probes.                                      |
| `dimensions`  | Which dimensions this probe contributes to, with a weight. Pick from your corpus's dimensions.                                 |
| `tier`        | When the probe runs (see below).                                                                                               |
| `evidence`    | Which evidence subsystems to gather. The runner shares evidence across probes.                                                 |
| `rationale`   | The *why* of the probe. 2–4 sentences. Shown in `repofit explain`.                                                             |
| `remediation` | What to do when the probe fails. Shown in human and HTML reports for failing probes.                                           |
| `detect`      | Async function: `(evidence) → Reading`. The actual check.                                                                      |
| `score`       | How to translate a Reading into a 0–100 score.                                                                                 |
| `fixtures`    | Synthetic inputs + expected outputs. Run as unit tests via `runFixture` — every probe is tested by its own fixtures.           |

### Tiers

| Tier         | When it runs                            | Cost                | Examples                                                |
| ------------ | --------------------------------------- | ------------------- | ------------------------------------------------------- |
| `static`     | Always.                                 | Cheap (file reads). | Does `CONTRIBUTING.md` exist? Is `.env` gitignored?     |
| `derived`    | Always.                                 | Cheap (CPU).        | Count ADRs. Compute p95 depth. Parse package.json.      |
| `historical` | Always.                                 | Cheap (git log).    | Conventional-commit conformance %.                      |
| `executed`   | Only with `--include executed`.         | Runs commands.      | `npm test` wall-clock; lint-clean predicate.            |
| `reasoned`   | Only with `--include reasoned`.         | Invokes an LLM.     | "Is this CLAUDE.md substance or platitudes?"            |

The default `repofit check` only runs `static`, `derived`, and `historical` —
the cheap, deterministic tiers. Users opt into `executed` or `reasoned`
explicitly with `--include`.

### Reading kinds

A reading is the data structure your probe returns. The score is computed
from the reading according to your `score` config.

| Kind          | Shape                                                                  | Use when                                                            |
| ------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `predicate`   | `{ value: boolean }`                                                   | Yes/no questions.                                                   |
| `count`       | `{ value: number, samples?: Location[] }`                              | Counting something. Samples are surfaced in the report.             |
| `magnitude`   | `{ value: number, unit: string }`                                      | Continuous measurement (time, size).                                |
| `distribution`| `{ samples: number[] }`                                                | A distribution of values; score uses a stat (`p50`/`p95`/`max`).    |
| `inventory`   | `{ items: { location, severity, message }[] }`                         | Lint-style: a list of issues with severity.                         |
| `judge`       | `{ score, perCriterion, rationale, model }`                            | LLM rubric-scored (reasoned tier).                                  |
| `na`          | `{ reason: string }`                                                   | Probe doesn't apply (e.g., no `package.json`).                      |
| `error`       | `{ message: string }`                                                  | Probe failed unexpectedly. Doesn't score.                           |

### Scoring

The `score` config tells the engine how to convert a reading into 0–100.

- `predicate`: `direction: "positive"` → true=100, false=0. `"negative"` inverts.
- `count` / `magnitude` / `distribution`: define `bands` of thresholds. Pick `direction`.
- `inventory`: define `severityWeights` (e.g., `{ info: 1, warn: 3, error: 10 }`) and `bands` over the weighted total.
- `judge`: scoring is intrinsic to the rubric — the LLM returns a score.

Example bands (lower count is better):

```ts
score: {
  kind: "count",
  direction: "negative",
  bands: [
    { upTo: 0,  score: 100 },
    { upTo: 2,  score: 80 },
    { upTo: 5,  score: 50 },
    { upTo: 10, score: 20 },
    { score: 0 },                // catch-all
  ],
}
```

### Evidence subsystems

The runner gathers evidence once and shares it across probes. Available subsystems:

| Subsystem        | What it provides                                                              |
| ---------------- | ----------------------------------------------------------------------------- |
| `files`          | Path existence + lazy text reads (`ev.files.has`, `ev.files.readText`).       |
| `size_stats`     | Tracked-file inventory from `git ls-files` (path, bytes, lines, depth).       |
| `node_package`   | Parsed `package.json`: scripts, deps, devDeps.                                |
| `agent_config`   | CLAUDE.md / AGENTS.md / .cursorrules inventory.                               |
| `ci_workflows`   | `.github/workflows/*.yml` raw contents (GitHub-specific).                     |
| `gitignore`      | Parsed `.gitignore` with `ignores(path)` predicate.                           |
| `commit_history` | Last N commits (sha, subject, authorEmail).                                   |
| `commands`       | `ev.commands.run({ argv, warmup, timeoutMs })` — for `executed`-tier probes. |
| `judge`          | `ev.judge.score({ probeId, probeVersion, input, rubric })` — reasoned probes. |
| `github_api`     | Branch protection, etc. Optional, requires `GITHUB_TOKEN` / `GH_TOKEN`.       |

Only request the subsystems you need — listing them in `evidence` is what triggers
gathering. Probes that don't request a subsystem get an opaque placeholder.

### Fixtures

Fixtures are how you test your probe. Each fixture supplies synthetic evidence
and asserts both the reading and the score the engine should produce.

```ts
fixtures: [
  {
    name: "present",
    evidence: { files: ["CONTRIBUTING.md"] },
    expect: { reading: { kind: "predicate", value: true }, score: 100 },
  },
  {
    name: "absent",
    evidence: { files: [] },
    expect: { reading: { kind: "predicate", value: false }, score: 0 },
  },
],
```

Wire them up to your test runner with `runFixture`:

```ts
import { describe, expect, test } from "vitest";
import { runFixture } from "@esbenwiberg/repofit/sdk";
import myProbe from "./my-probe.js";

describe(myProbe.id, () => {
  for (const fixture of myProbe.fixtures) {
    test(fixture.name, async () => {
      const outcome = await runFixture(myProbe, fixture);
      expect(outcome.ok).toBe(true);
    });
  }
});
```

Every probe in the default corpus is tested this way. You should aim for at
least one positive fixture, one negative, and one `na` if your probe has a
disapply path.

## Registering a probe in a corpus

A corpus is a package that exports `probes` and `dimensions`. Layout:

```
my-corpus/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── dimensions/
    │   └── my-dimension.ts
    └── probes/
        ├── feat-my-thing.ts
        └── ...
```

`src/index.ts`:

```ts
import { createRequire } from "node:module";
import myDimension from "./dimensions/my-dimension.js";
import myProbe from "./probes/feat-my-thing.js";

const pkg = createRequire(import.meta.url)("../package.json") as {
  name: string;
  version: string;
};

export const meta = { name: pkg.name, version: pkg.version };
export const probes = [myProbe];
export const dimensions = [myDimension];
```

> Note: the v1.0.0 CLI loads `@esbenwiberg/corpus-default` directly. Loading a
> custom corpus by package name from `repofit.config.json` is on the roadmap;
> for now, build against the SDK in-tree (your custom probes can live in your
> repo and be tested with `runFixture`).

## Style guide

- **rationale** — Explain the *why*, not the *what*. The `detect` function shows what.
- **remediation** — Be concrete. Name commands, paths, or links. Bad: "Improve your docs." Good: "Add `## Build` and `## Test` sections to README.md with copy-pasteable commands."
- **id** — `category.what-it-checks`. Categories tend to cluster (`docs.*`, `safety.*`, `latency.*`). Keep them stable; users may reference them in baselines and waivers.
- **dimensions** — Don't over-claim. A probe rarely belongs to more than two dimensions, and if it does, give the secondary a smaller weight.
- **fixtures** — Cover the happy path, the failure path, and the `na` path. Three is the floor; more is good.

## Suppressing findings (waivers)

Sometimes a probe flags a finding that is correct but can't be fixed — vendored code, generated files, intentional design choices. Waivers let you suppress specific findings with a stated reason, without disabling the whole probe.

A waiver is keyed by `(probeId, location)`. Today the engine applies waivers to `inventory` and `count` readings — the kinds that produce per-file findings. Predicate/magnitude/distribution/judge readings don't carry per-location findings, so a waiver against them is inert.

```bash
# Add: takes the probe id and the file path the probe flagged, plus a reason.
repofit waive add size.large-files vendor/big.json \
  --reason "vendor data, see ADR-7"

# Optional expiration date (ISO YYYY-MM-DD). After this date the waiver is invalid.
repofit waive add size.large-files vendor/big.json \
  --reason "tracking upstream cleanup" \
  --expires 2026-09-01

# List: shows a stable 12-char hash per waiver, used by `rm`.
repofit waive ls
#   abc123def456  size.large-files  vendor/big.json
#                 vendor data, see ADR-7

# Remove by hash.
repofit waive rm abc123def456
```

Waivers live in `repofit.config.json` under the top-level `waivers` array. The schema is `{ probeId, location, reason, expires? }`. You can edit the file by hand if you prefer — the CLI is just a convenience.

**Best practice:** require a non-trivial `--reason` in code review. Waivers without context become technical debt no one remembers.

## Authoring fixers (`repofit apply`)

A **fixer** is a deterministic remediation paired with a probe. Where a probe says "you don't have a CLAUDE.md", a fixer says "here's a CLAUDE.md scaffold I can write for you." Users invoke fixers with `repofit apply` — dry run by default, `--write` to actually change files.

```ts
// fixers/agent-guidance-present.ts
import { defineFixer } from "@esbenwiberg/repofit/sdk";

export default defineFixer({
  probeId: "agent.guidance-present",
  mode: "static",
  describe: "scaffold CLAUDE.md",
  async plan({ cwd, probe, reading }) {
    return {
      actions: [
        { kind: "write-file", path: "CLAUDE.md", content: "# …\n", ifMissing: true },
      ],
      notes: ["edit the scaffold to reflect the actual project before committing"],
    };
  },
});
```

Export the fixer from your corpus alongside `probes` and `dimensions`:

```ts
// src/index.ts
export const fixers = [agentGuidancePresentFixer /* … */];
```

### Action kinds

- `{ kind: "write-file", path, content, ifMissing? }` — write a whole file. With `ifMissing: true`, skip if the file already exists (safe default for scaffolds).
- `{ kind: "append-lines", path, lines, createIfMissing? }` — append lines that aren't already present in the file. Use this for `.gitignore` / `.editorconfig` / hook files where you're augmenting, not replacing.

### When `plan` returns `null`

If your fixer detects nothing to do (e.g. the file is already correct), return `null` from `plan`. The CLI will skip it cleanly.

### LLM-mode fixers

Some artifacts (READMEs, per-package CLAUDE.md, ADRs) only become useful when they're *specific to the project*. A generic scaffold is barely better than nothing; a tailored one is a real win. For those, write an LLM-mode fixer — Claude generates the content, your code wraps it into a `write-file` action.

```ts
// fixers/agent-guidance-present-llm.ts
import { defineFixer } from "@esbenwiberg/repofit/sdk";

const SYSTEM = `You are writing a CLAUDE.md for a project. …`;

export default defineFixer({
  probeId: "agent.guidance-present",
  mode: "llm",
  describe: "generate CLAUDE.md with Claude",
  async plan({ cwd, generate }) {
    const context = await collectProjectContext(cwd);
    const content = await generate(buildPrompt(context), { system: SYSTEM, maxTokens: 4096 });
    return {
      actions: [{ kind: "write-file", path: "CLAUDE.md", content, ifMissing: true }],
      notes: ["review before committing — may contain TODO markers or guesses"],
    };
  },
});
```

Users opt into LLM fixers explicitly with `--with-llm`:

```bash
# Static fixers only (default — no API costs, deterministic).
repofit apply

# Use LLM fixers when registered. Falls back to static for probes without an LLM fixer.
repofit apply --with-llm

# Force a specific transport.
repofit apply --with-llm --llm-transport api    # requires ANTHROPIC_API_KEY
repofit apply --with-llm --llm-transport cli    # requires `claude` on PATH
```

The same probe can have both a static and an LLM fixer registered. Without `--with-llm`, the static one runs. With `--with-llm`, the LLM one is preferred; if no LLM fixer is registered for a probe, the static one runs as a fallback. This lets you ship `apply` that works offline and degrades cleanly when no API key or CLI is around.

### Best practices

- **Be conservative.** Prefer `ifMissing: true` and `append-lines` over destructive writes — for both static and LLM fixers.
- **Be specific.** A scaffold should give the user something to *react to*, not a perfect answer. A `TODO` marker is honest; a fabricated paragraph isn't. Bake this rule into your LLM system prompts.
- **Don't over-script.** `apply` is for the obvious 80%. The remaining 20% (subtle architectural choices, conventions tied to team culture) is better left to humans.

## See also

- [Probe schema](design/probe-schema.md) — the full type reference.
- [`@esbenwiberg/corpus-default`](../packages/corpus-default/) — read the source for ~45 worked examples.
- `repofit explain <probe-id>` — inspect any probe (yours or built-in).
