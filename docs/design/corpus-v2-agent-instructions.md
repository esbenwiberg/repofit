# repofit — default corpus v2: the `agent.*` family

> **Status:** draft for review. Replaces the `agent.*` rows of
> [`corpus-v1.md`](./corpus-v1.md). Grounded in the
> [agent-instructions field study](../research/agent-instructions-field-study-2026-11.md)
> (55 repositories, November 2026). Nothing here is locked until reviewed; the
> versioning decision (§8) becomes an ADR once agreed.

---

## 1. Why v1's `agent.*` probes are wrong now

The v1 family was written when a CLAUDE.md was a novelty and "more guidance"
was a safe proxy for "better guidance". The field study says the opposite is
now true for the repositories that do this well. Three v1 probes reward what
the study lists as rot:

| v1 probe | What it rewards | Study finding it contradicts |
|---|---|---|
| `agent.guidance-substance` | More lines in the root file (bands rise to 100 at ~200 lines) | Monolith roots are anti-pattern 2; a root line "is paid for by every task in the repo". The winners are ≤ 6 KB roots that route. |
| `agent.guidance-nested` | A guidance file in every sub-package | Stub nesting is anti-pattern 8 (litellm: 102 nested files, ~15 of them one line). Nested files belong only where domain priorities differ. |
| `agent.skills-present` | Count of `SKILL.md` files anywhere | Copies instead of symlinks is anti-pattern 3 (stripe: 10 skills × 6 provider dirs). Copies inflate the count and score higher than one linked source. |

The four reasoned probes are directionally fine but spend LLM calls on checks
that are deterministic (`agent.guidance-fresh` asks a model whether referenced
paths exist and commands are defined), and their rubrics predate the patterns
the study found. They also default to `claude-haiku-4-5` / `gpt-4o-mini`.

Nothing in the engine knows about symlinks, nested instruction files, skills
trees, harness settings or frontmatter. That is the real gap: the probes could
not be written correctly against v1 evidence even if we wanted to.

### What v2 does not change

Dimensions and weights (`dimensions.md`), the probe schema, the SDK, the
reporters and the ratchet/pinning model (ADR-0004, ADR-0005). Every other
probe family is untouched. This is a corpus change plus one additive evidence
extension.

---

## 2. Principles for the v2 family

1. **Deterministic first.** If a check can be done by reading files, it is a
   static/derived probe. The judge tier is reserved for substance: "is this
   instructions or a docs dump", "does the skill body teach what its
   description promises", "is this fact stale". A judge probe receives the
   deterministic findings as input so it never re-derives them.
2. **Score the shape, not the byte count.** The study's root-size controversy
   has two coherent camps (thin-and-routed, fat-and-measured) and one
   incoherent one (fat with neither budget nor routing). repofit's *default
   opinion* is thin-and-routed; the fat-and-measured camp has an explicit
   escape hatch (§5.2) rather than a heuristic that guesses at it.
3. **Penalise drift mechanics, not tool choice.** We score copies, blind
   references, undefined commands, tool-specific syntax in shared files and
   committed local settings. We do not score whether a repo uses hooks, rule
   tags, review-rule files or an admission-criteria block; those are live
   controversies or single-repo patterns (§7).
4. **`na` beats a guess.** A probe that cannot see its subject (no skills, one
   root file, no nested files) returns `na` and drops out of the score, as
   today's reasoned probes already do.
5. **Harness-agnostic surfaces.** The gatherer recognises the instruction and
   skill surfaces of every harness the study met (AGENTS.md, CLAUDE.md,
   GEMINI.md, `.cursorrules`, `.cursor/rules/*.mdc`, `.github/copilot-instructions.md`,
   `.github/instructions/*.md`, `.claude/rules/*.md`, `.aider.conf.yml`,
   `**/SKILL.md`, `.claude/settings*.json`, `.codex/*`, `.gemini/settings.json`,
   `.cursor/hooks.json`). A probe never hard-codes one vendor's layout as the
   only correct one; it checks that whatever layout exists has one source.

---

## 3. Evidence: extend `agent_config`, additively

The `agent_config` subsystem today reads five root files. v2 extends
`AgentConfigEvidence` with three optional arrays; existing fields keep their
shape, so third-party probes keep compiling (ADR-0003 registry unchanged,
engine minor bump).

```ts
interface AgentConfigEvidence {
  guidance: GuidanceFile[];            // unchanged: root candidates
  has(path: string): boolean;          // unchanged
  instructionFiles: InstructionFile[]; // NEW
  skills: SkillFile[];                 // NEW
  harnessConfig: HarnessConfigFile[];  // NEW
}

interface LinkInfo { target: string; targetExists: boolean; insideRepo: boolean }

interface InstructionFile {
  path: string; depth: number; bytes: number; lines: number;
  sha256: string;                 // content hash for copy detection
  link: LinkInfo | null;          // non-null when the path is a symlink
  includes: string[];             // `@path` include lines, unresolved
}

interface SkillFile {
  path: string;                   // .../SKILL.md
  dir: string;                    // skill directory
  root: string;                   // ".agents/skills", ".claude/skills", ".codex/skills", ...
  frontmatter: { name?: string; description?: string; raw: Record<string, unknown> } | null;
  bodyLines: number; sha256: string; link: LinkInfo | null;
  dirLink: LinkInfo | null;       // when the *root* dir is a symlink (xpm style)
  hasEvals: boolean; hasReferences: boolean;
}

interface HarnessConfigFile {
  path: string; link: LinkInfo | null;
  json: unknown | null;           // parsed when valid JSON, else null
  parseError: string | null;
}
```

### How it is gathered

- **Enumeration** reuses the tracked-file list `size_stats` already obtains
  from `git ls-files`; the gatherer only reads paths that match the surface
  list in §2.5, capped at 256 KiB per file. Untracked files are invisible on
  purpose: a scan measures what the repository ships.
- **Symlinks** come from `git ls-files -s` (mode `120000`), which is true even
  on a Windows checkout with `core.symlinks=false` where the working tree holds
  the link as a text file. `lstat` is the fallback for a repo without git
  metadata. Targets are resolved relative to the link's directory and
  confined to the repository root; a target outside the root sets
  `insideRepo: false` and `targetExists: false` (anti-pattern 9, dangling
  layering).
- **Copies** are detected by equal `sha256` on two paths neither of which is a
  link to the other. Whitespace-only differences count as copies after
  trimming line ends; anything else is a drifted parallel and is reported as
  such.
- **Frontmatter** is the YAML block between the first two `---` lines; only
  scalar `name`/`description` are interpreted, the rest is kept raw. A
  malformed block yields `frontmatter: null`, which the probes treat as
  "missing", not as an error.
- **JSON settings** parse under try/catch. Invalid JSON is recorded, not
  thrown; whether a settings file parses is a lint concern, not an `agent.*`
  concern.

### Known limits

- A Windows checkout that replaced the symlink with a junction (xpm's
  unprivileged fallback) is untracked, so the gatherer sees no alias at all
  and reports "no harness alias", not "copy". That is the honest reading: the
  junction is not what the repository ships.
- Sparse or partial checkouts hide link targets; `targetExists: false` then
  overstates breakage. The remediation text says so.

---

## 4. The v2 `agent.*` family at a glance

| id | tier | status | dimensions (weight) | reading | study source |
|---|---|---|---|---|---|
| `agent.guidance-present` | static | kept, v2 | context 1 | predicate | anti-pattern 12 |
| `agent.root-budget` | static | **new** (replaces `guidance-substance`) | context 1, cost 0.5 | magnitude (bytes) | blueprint 1, controversy 2 |
| `agent.root-routes` | static | **new** | context 1 | count | blueprint 1 & 6 |
| `agent.nested-guidance-lean` | static | **new** (replaces `guidance-nested`) | context 1, cost 0.3 | inventory | blueprint 2, anti-patterns 2 & 8 |
| `agent.harness-adapters-thin` | static | **new** | consistency 1, context 0.5 | inventory | anti-pattern 3, layering |
| `agent.skills-present` | static | kept, v2 (dedup) | context 1, feedback 0.3 | count | blueprint 3 |
| `agent.skills-single-source` | static | **new** | consistency 1 | inventory | anti-pattern 3 |
| `agent.skill-descriptions-trigger` | static | **new** | context 1 | inventory | blueprint 3 |
| `agent.references-resolve` | static | **new** | context 1, consistency 0.7 | inventory | blueprint 10, anti-patterns 5 & 9 |
| `agent.commands-resolve` | derived | **new** | consistency 1, context 0.7 | inventory | anti-pattern 4 |
| `agent.shared-files-portable` | static | **new** | consistency 0.7 | inventory | anti-pattern 10 |
| `agent.local-settings-not-committed` | static | **new** | safety 0.5 | predicate (negative) | anti-pattern 11 |
| `agent.skill-evals-present` | static | **new, opt-in** | feedback 0.5 | magnitude (%) | blueprint 9 |
| `agent.guidance-quality` | reasoned | kept, rubric v2 | context 1, feedback 0.3 | judge | anti-patterns 1, 6, 7 |
| `agent.guidance-fresh` | reasoned | kept, narrowed | context 1, consistency 0.5 | judge | anti-pattern 7 |
| `agent.guidance-aligned` | reasoned | kept, rubric v2 | context 1, consistency 0.7 | judge | anti-pattern 4 |
| `agent.skills-quality` | reasoned | kept, rubric v2 | context 1, feedback 0.5 | judge | blueprint 3 & 9 |
| `agent.guidance-substance` | — | **removed** | — | — | §1 |
| `agent.guidance-nested` | — | **removed** | — | — | §1 |

Nine new always-on deterministic probes, one opt-in, two kept with new
semantics, four reasoned kept with rewritten rubrics, two removed. Opt-in
here means the probe is excluded unless listed in `gate.include`, the same
mechanism that already gates the `executed` and `reasoned` tiers; it needs a
small engine extension to allow probe ids (not just tiers) in `include`.
If that extension is unwanted, `skill-evals-present` ships always-on at
weight 0.3 instead (§9, question 2).

---

## 5. Probe specifications

Each spec gives: subject, detection, bands, `na` conditions, false-positive
controls, remediation. Fixtures are listed in §6.

### 5.1 `agent.guidance-present` (kept, version 2)

Unchanged predicate: any root instruction file exists. v2 adds `GEMINI.md`,
`.cursor/rules/`, `.github/instructions/` and `.claude/rules/` to the
candidate set so a repo that chose one of those is not "invisible". Existing
static and LLM fixers stay.

### 5.2 `agent.root-budget` (new)

**Subject.** Effective byte size of the canonical root instruction file after
resolving `@include` lines (the existing `readGuidanceParts` resolver). The
canonical root is `AGENTS.md` when present, else the largest of the root
candidates that is not a link or an include-only pointer.

**Bands.** `≤ 6 144 → 100`, `≤ 12 288 → 85`, `≤ 24 576 → 60`,
`≤ 49 152 → 30`, else `0`. The first band is the blueprint's 6 KB; the ladder
tracks the study's observed clusters (adk 1.4 KB, xpm 8 KB, next.js 31 KB,
openai-agents 38 KB, PostHog 47 KB).

**Escape hatch for fat-and-measured.** A repo that deliberately keeps a large,
budgeted, enforcement-tested root (PostHog) waives or disables this probe in
`repofit.config.json`; the remediation text names that option explicitly.
We considered returning `na` when a test file mentions the root by name and a
byte or line number, and rejected it: the heuristic cannot tell "a test that
enforces the budget" from "a test that mentions the file", and a silent `na`
hides the opinion the user should be making on purpose.

**`na`.** No root instruction file (already scored by `guidance-present`).

**Remediation.** Move rules into scoped guides, skills or `docs/` and leave a
routing table; or waive with a reason if the repo measures and enforces a
larger budget.

### 5.3 `agent.root-routes` (new)

**Subject.** Does the root *route*? Count of distinct repository-internal
references in the canonical root that resolve: markdown link targets,
backticked paths, `/skill-name` or `skill-name` entries that match a skill
`name`, and `@include` lines. Only the resolving ones count; the broken ones
belong to `references-resolve`.

**Bands.** `0 → 0`, `≤ 2 → 50`, `≤ 5 → 80`, else `100`.

**Why a separate probe from `root-budget`.** A 1.4 KB root with no routing
is thin, not routed: the agent has nowhere to go. Scoring both lets the report
say which half is missing. Combining them into one number would hide that.

**`na`.** No root instruction file.

### 5.4 `agent.nested-guidance-lean` (new)

**Subject.** Every instruction file below the root. An offending file is one
of: a **stub** (fewer than 200 bytes of non-frontmatter, non-link content, or
content that is a single URL), a **manual** (over 24 KiB), a **restatement**
(≥ 3 lines of ≥ 40 characters byte-identical to lines in the root after
trimming), or a **chain overflow** (root plus every ancestor instruction file
above it exceeds 32 KiB, the smallest default chain budget any harness
documents).

**Reading.** Inventory of offenders with the reason per path.
**Bands (count of offenders).** `0 → 100`, `1 → 70`, `≤ 3 → 40`, else `0`.
**`na`.** No nested instruction files. A repository with only a root is not
penalised; v1's "every package needs one" opinion is gone.

**False-positive controls.** Pointer files whose only content is
`@AGENTS.md` (xpm's scoped `CLAUDE.md` wrappers) are *adapters*, not stubs,
and are scored by `harness-adapters-thin` instead. Restatement ignores
headings and table separator lines.

### 5.5 `agent.harness-adapters-thin` (new)

**Subject.** When a directory holds a canonical instruction file and one or
more harness-specific siblings (`CLAUDE.md`, `GEMINI.md`,
`.github/copilot-instructions.md`, `.cursorrules`), each sibling must be a
symlink to the canonical file or a pointer whose only content is an include
of it. Offenders: byte-identical copies ("copy"), siblings with their own
substantive content ("drifted parallel", the deno/transformers/agno case), and
links whose target is missing or outside the repo ("dangling").

**Canonical choice.** `AGENTS.md` when present; otherwise the probe returns
`na` because there is no shared source to be thin against, and
`guidance-aligned` (reasoned) is the right tool for two independent files.

**Bands (count of offenders).** `0 → 100`, `1 → 60`, else `0`.
**`na`.** Fewer than two instruction files in any one directory, or no
`AGENTS.md` anywhere.

Note that repofit's own root fails this today (`CLAUDE.md` and `AGENTS.md`
differ). Dogfooding will show it; that is the point.

### 5.6 `agent.skills-present` (kept, version 2)

Same bands (`0 → 0`, `1 → 60`, `≤ 3 → 80`, else `100`) over the number of
**distinct** skills: skills are deduplicated by resolved path (links collapse
onto their target) and then by `sha256` (copies collapse onto one). Evidence
moves from `size_stats` to `agent_config`.

### 5.7 `agent.skills-single-source` (new)

**Subject.** When skills exist under more than one root
(`.agents/skills` and `.claude/skills`, or several provider dirs), every
non-canonical root must reach the canonical one by a link: either the root
directory is a symlink (xpm), or each skill directory or `SKILL.md` is.
Canonical root is `.agents/skills` when present, otherwise the root with the
most non-link skills.

**Offenders.** Copies (equal hash, no link), drifted copies (same skill
`name`, different hash, no link), dangling links.
**Bands (count of offenders).** `0 → 100`, `1 → 70`, `≤ 3 → 40`, else `0`.
**`na`.** Skills under only one root, or no skills.

### 5.8 `agent.skill-descriptions-trigger` (new)

**Subject.** Each distinct skill's frontmatter. Conforming means: `name`
present and equal to the directory name; `description` present, 40–1 024
characters, and containing a trigger cue (`use when`, `when `, `use for`,
`don't use`, `do not use`, `not for`, case-insensitive); body under 500 lines.

**Reading.** Inventory of non-conforming skills with the failed rule.
**Bands (share conforming).** `100% → 100`, `≥ 80% → 80`, `≥ 50% → 50`,
else `20`.
**`na`.** No skills.

The judge probe `skills-quality` keeps the question this cannot answer: does
the body teach what the description promises?

### 5.9 `agent.references-resolve` (new)

**Subject.** Every repository-internal reference in instruction files,
skill frontmatter and harness hook commands: markdown link targets,
backticked paths, `@include` lines, `/skill-name` mentions, and the script
paths named in hook `command` strings. A reference is **blind** when its
parent directory exists in the tracked tree but the target does not, or when
it is a `/skill` whose name matches no skill, or when it is a link whose
target is missing.

**False-positive controls.** The "parent exists" rule is what separates
sentry's five phantom skills from a documentation example like
`src/your-module/index.ts`. References containing `<`, `>`, `*`, `{` or `}`
are templates and are skipped. URLs are skipped. Paths under `node_modules`,
`dist`, `build` are skipped because they are legitimately untracked.

**Reading.** Inventory of blind references, grouped by file.
**Bands (count).** `0 → 100`, `1 → 70`, `≤ 3 → 40`, else `0`.
**`na`.** No instruction files.

### 5.10 `agent.commands-resolve` (new, derived)

**Subject.** Commands the instruction files tell the agent to run, checked
against what the repository defines: `npm|pnpm|yarn|bun run <script>` against
`node_package.scripts`; `make <target>` against Makefile targets; `python3
<path>.py` and `./<path>` against tracked files; `cargo`, `go`, `dotnet`
subcommands are not checked (they are toolchain verbs, not repo definitions).

**Reading.** Inventory of undefined commands with the file that names them.
**Bands (count).** `0 → 100`, `1 → 70`, `≤ 3 → 40`, else `0`.
**`na`.** No instruction files, or none that names a checkable command.

This moves the `commands-valid` criterion out of `guidance-fresh`'s rubric.
The study's drifted parallels (deno, transformers) are exactly this probe
firing on one of two files.

### 5.11 `agent.shared-files-portable` (new)

**Subject.** Files meant for every harness (`AGENTS.md` at any depth,
`.agents/skills/**`) must not contain one harness's syntax: GitHub Actions
templating (`${{`), tool-call XML tags from a specific harness
(`<read_file>`, `<execute_command>`, `<attempt_completion>`), or vendor
steering blocks (`<corridor>`). Harness-specific files (`CLAUDE.md`,
`.claude/**`, `.cursor/**`) are exempt; that is what they are for.

**Reading.** Inventory of offending lines (path, line, token).
**Bands (count of files).** `0 → 100`, `1 → 50`, else `0`.
**`na`.** No shared files.

### 5.12 `agent.local-settings-not-committed` (new)

**Subject.** Negative predicate over tracked paths: `.claude/settings.local.json`,
`.codex/config.local.*`, `.cursor/settings.local.json`, `.gemini/settings.local.json`.
Local settings carry machine allowlists and sometimes environment values;
committing them is a leak vector and a drift source.

**Dimension.** Safety 0.5. Safety gates fitness, so one committed local
settings file caps the score; that is deliberate and proportionate to what
those files tend to hold. A fixer appends the paths to `.gitignore`; it does
not `git rm --cached`, because deleting tracked content is the user's call.

### 5.13 `agent.skill-evals-present` (new, opt-in)

**Subject.** Share of distinct skills with an `evals/` directory containing at
least one file. **Bands.** `≥ 50% → 100`, `≥ 25% → 70`, `> 0% → 40`, `0 → 0`.
**`na`.** No skills.

Opt-in because the study found evals in 4 of 55 repositories; scoring every
repository down for a practice this young would be a ratchet-breaker with no
decision value. It becomes always-on in a later corpus when the practice is
common enough that its absence is informative.

### 5.14 Reasoned probes (kept, rubrics rewritten)

All four keep their ids, bump `PROBE_VERSION` (which invalidates the disk
cache for them) and take the deterministic findings as part of `input` so the
model is told what has already been checked.

- **`agent.guidance-quality`** rubric: *instructions, not documentation*
  (anti-pattern 1); *operating boundaries present* (an Always / Ask first /
  Never shape, however named); *tone is boundaries, not shouting*
  (anti-pattern 6); *no session state committed as fact* ("current work",
  branch names, "no tests found"; anti-pattern 7); *admission discipline*
  (does the file say how it grows, or is it a landfill).
- **`agent.guidance-fresh`** rubric narrows to claims deterministic probes
  cannot test: version numbers versus manifests, described architecture
  versus the tree summary, statements of what exists ("no tests") versus
  counts the evidence provides. The `paths-exist` and `commands-valid`
  criteria are deleted.
- **`agent.guidance-aligned`** keeps its four criteria; the input now excludes
  files that `harness-adapters-thin` identified as links or pure pointers, so
  the model compares real parallels only.
- **`agent.skills-quality`** rubric: *body teaches what description
  promises*; *procedural over encyclopaedic* (manuals belong in
  `references/`); *failure the skill prevents is stated* (blueprint 9's "if
  you didn't watch the agent fail without it").

**Default models.** `DEFAULT_JUDGE_MODEL` moves from `claude-haiku-4-5` to
`claude-haiku-5-5`. The OpenAI default (`gpt-4o-mini`) is replaced with the
current small model after a catalogue check during implementation; this doc
does not assert an id from memory. A changed default shifts reasoned scores
for existing baselines; the config already lets a repository pin the model,
and the v2.0.0 release note tells users to re-accept.

---

## 6. Fixtures and tests

Every probe ships `fixtures` covering: the clean case, each offender class
once, the `na` case, and one false-positive guard (the template path, the
`@AGENTS.md` adapter, the documentation example). Fixture evidence is built
with a small helper in `probes/_shared/agent-evidence-fixture.ts` that
constructs `AgentConfigEvidence` from an in-memory file map, so fixtures do
not touch disk.

Engine tests for the gatherer use temporary git repositories: one with real
symlinks, one with `core.symlinks=false` to assert the index path, one with a
link pointing outside the root, one with no `.git` to assert the `lstat`
fallback.

Dogfood: `repofit check` on this repository after the change is expected to
flag `harness-adapters-thin` (root `CLAUDE.md` differs from `AGENTS.md`) and
`skills-single-source` or `skills-present` depending on how `agents/skills`
is treated (it is not under a recognised root today; see question 4). Fixing
repofit's own layout is part of the delivery, not a separate task, because a
corpus that fails on its own repository is not credible.

---

## 7. Deliberately not scored

| Study item | Why not | Where it lives instead |
|---|---|---|
| Hooks (blueprint 5) | Live controversy (PostHog vs Vercel). A probe that scores hook presence or absence takes a side by default. | Hook *commands* that reference missing scripts are caught by `references-resolve`. Revisit when the field converges. |
| Rule tags `[lint: id]` / `[review]` (blueprint 4) | One repository's convention; mandating it penalises every other coherent layout. | `guidance-quality` rubric asks whether the file says how it grows. |
| Review-rule files (blueprint 7) | No shared format exists across harnesses yet. | Nothing. Candidate for a later `review.*` family. |
| Admission criteria block (blueprint 8) | Prose shape, not reliably detectable. | `guidance-quality` rubric. |
| Shouting (anti-pattern 6) | Deterministic caps/exclamation ratios misfire on legitimate warnings. | `guidance-quality` rubric. |
| Who edits the instruction file (controversy 3) | Governance, not repository shape. | Nothing. |

---

## 8. Versioning and delivery

- **`@esbenwiberg/corpus-default` 2.0.0.** Two probe ids are removed and two
  change meaning; ADR-0005 says baselines pin the exact corpus version, so
  users see the drift warning and re-accept with `repofit check --accept`.
  A config that disables or waives a removed id gets a warning naming the
  replacement, not an error.
- **`@esbenwiberg/repofit` 1.3.0.** Additive evidence fields, optional
  probe-id `include`, judge default model change. No SDK removals.
- **Dependency refresh ships first, in its own PR.** TypeScript 7, vitest 5,
  biome 2.6, the two LLM SDKs and commander 15 are mechanical but noisy; the
  corpus diff should be reviewable on its own.
- **Order inside the corpus PR:** evidence extension with tests → static
  probes with fixtures → reasoned rubric and model changes → repofit's own
  layout fixed → baseline re-accepted → release notes under
  `docs/release/v2.0.0.md` (corpus) and `v1.3.0.md` (engine) → ADR-0007
  recording the thin-and-routed default opinion and its escape hatch.
- **Blast radius.** Any repository scanning with this corpus will see its
  Context score move. Repositories with copies, blind references or
  undefined commands will drop; that is the signal. Repositories without
  skills or nested files are mostly unaffected because the new probes return
  `na`.

---

## 9. Review decisions and open questions

Decided in review (2026-11-02): bands 6/12/24/48 KB with the waiver escape hatch (1); `skill-evals-present` opt-in through probe ids in `include` (2); repofit's own skills move to `.agents/skills` with a `.claude/skills` link in this delivery (4); publishing under the personal scope stays as is for now (5). Item 3 is still open.

1. **Root budget bands.** 6 / 12 / 24 / 48 KB with a waiver escape hatch, or
   softer (8 / 16 / 32 / 64)? The study supports the former; xpm sits in the
   second band under either.
2. **`skill-evals-present` gating.** Opt-in via probe-id `include` (small
   engine change) or always-on at weight 0.3 (no engine change, mild ratchet
   pressure on every repo with skills)?
3. **Safety placement of `local-settings-not-committed`.** Gating safety at
   0.5 caps the whole score for one committed file. Right, or too blunt for a
   file that often holds only permission allowlists?
4. **repofit's own skills live in `agents/skills/`** (no leading dot), which
   none of the harnesses in the study read. Move to `.agents/skills` with a
   `.claude/skills` link as part of this delivery, or keep and treat the
   current layout as a recognised root?
5. **Publishing scope.** The packages publish under the personal npm scope
   `@esbenwiberg`. That is unchanged by this design, but the release step is
   an external action on a personal scope done from a work subscription;
   confirm that is intended before `npm publish`, or publish from elsewhere.
