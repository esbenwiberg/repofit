# Catalog Schema

The contract that every entry in `content/catalog/*.toml` follows. Read
by the future `agentry` verbs:

- `agentry doctor` — checks `detect.any_of` against the target repo to
  decide what's installed, missing, or partial.
- `agentry add <id>` — copies each `[[provides]]` file from `content/`
  into the target repo using its `target` path and `conflict` policy.
- `agentry coach <id>` — references the entry to know which files exist
  as installable scaffolding vs which need authoring.

This schema is **locked by [ADR-0002](../../docs/adr/0002-catalog-schema.md)**.
Don't add fields without an amending ADR.

## Format

One TOML file per entry, named `<id>.toml`. Filename must equal the `id`
field. The CLI globs `content/catalog/*.toml` to enumerate entries; no
index file.

## Example — minimal entry

```toml
id = "commits"
name = "Commit workflow"
description = "Structured commit format and workflow."
version = "0.1.0"

layers = ["harness", "conventions"]

[[provides]]
source  = "skills/commits/skill.md"
target  = ".claude/skills/commits/skill.md"
flavor  = "claude"
conflict = "prompt"

[[provides]]
source  = "recipes/commits/conventional-commits.md"
target  = ".agentry/recipes/commits/conventional-commits.md"
flavor  = "agnostic"
conflict = "prompt"

[detect]
any_of = [
  ".claude/skills/commits/skill.md",
  ".agentry/recipes/commits/conventional-commits.md",
]

[requires]
git = true
```

## Fields

### Identity (required)

| Field | Type | Notes |
|---|---|---|
| `id` | string | CLI identifier. Kebab-case. Must equal the filename stem. Stable across versions. |
| `name` | string | Human-readable title. Sentence case. |
| `description` | string | One-line summary, ≤120 chars. Shown in `agentry list` and `doctor` output. |
| `version` | semver | Entry version, **independent of agentry's version**. Bump on any `[[provides]]` change. |

### Categorization (optional)

| Field | Type | Notes |
|---|---|---|
| `layers` | string[] | Which of the seven agent-readiness layers this serves. Drives `doctor`'s grouping. Valid values: `context`, `conventions`, `specs`, `harness`, `execution`, `validation`, `architecture`. |

Tags are intentionally excluded in v1 — the `layers` field is the only
classification axis. If a need for finer-grained filtering shows up, an
amending ADR adds `tags`.

### `[[provides]]` (one or more)

Each `[[provides]]` is one file the entry installs.

| Field | Type | Notes |
|---|---|---|
| `source` | path | Path under `content/` (no leading slash). The file must exist in this repo. |
| `target` | path | Path under the target repo's root. |
| `flavor` | enum | `claude`, `agnostic`. The installer can filter by flavor (`--no-claude` / `--no-recipe`). |
| `conflict` | enum | `prompt` (default), `overwrite`, `skip-if-exists`. See below. |

**Target path conventions** (not enforced — guidance):

- Claude-flavoured skill content → `.claude/skills/<id>/...`
- Claude-flavoured commands → `.claude/commands/<command>.md`
- Claude-flavoured rules → `.claude/skills/<id>/rules.md` (next to skill)
- Agnostic recipes → `.agentry/recipes/<id>/...`
- Hooks → `.githooks/...`
- Scripts → `_scripts/...`
- ADR / decisions templates → `docs/adr/...` or `docs/decisions/...`

**Conflict policies:**

- `prompt` — if the target exists with different content, the installer
  prompts the user (keep / overwrite / show-diff / skip). Default for
  almost everything.
- `overwrite` — replace target unconditionally. Reserved for files we
  *know* a user shouldn't be editing locally (e.g., a script we
  maintain). Use sparingly.
- `skip-if-exists` — if the target exists, do nothing (no prompt). Use
  for seed files the user is expected to own after first install.

There is **no `merge` policy** in v1. Merging Markdown is unreliable;
when an entry needs to extend an existing file, the right answer is a
new file or an explicit ADR.

### `[detect]` (required)

Tells `doctor` how to recognise an existing install.

| Field | Type | Notes |
|---|---|---|
| `any_of` | path[] | If **any** of these paths exists in the target repo, doctor reports the entry as installed. |

`detect.any_of` should generally list the most distinctive `target`
paths from `[[provides]]`. Don't list every provided file — one or two
canonical signals are enough.

A future `all_of` field is reserved but not implemented in v1.

### `[requires]` (optional)

Soft prerequisites. The CLI surfaces these to the user but does not
auto-install them.

| Field | Type | Notes |
|---|---|---|
| `git` | bool | If `true`, the target repo must be a git repository. |
| `entries` | string[] | Other catalog entry `id`s this entry depends on. The installer offers to install them too. |
| `tools` | string[] | External CLI tools the user should have for the installed content to be useful (e.g., `gh`, `gitleaks`). Soft check; warns but doesn't block. |

### Lifecycle (optional)

| Field | Type | Notes |
|---|---|---|
| `deprecated_by` | string | If set, the entry is hidden from `agentry list` by default and `doctor` recommends migrating to the named successor. |

## Filename and `id` invariants

- `id` is kebab-case (`commits`, `code-review`, not `CodeReview` or `code_review`).
- The filename is `<id>.toml`. Renaming requires bumping `version` to a
  major (or shipping a `deprecated_by` redirect).
- Once an `id` is published, **never repurpose it**. Add a new entry
  with a new id and use `deprecated_by` on the old one.

## Validation rules (enforced by the installer)

- `id` matches `^[a-z][a-z0-9-]*$`.
- `id` equals the filename stem.
- Every `source` path resolves under `content/` and exists in the repo.
- Every `target` path is repo-relative (no leading `/`, no `..`).
- Every `target` path is unique within an entry.
- `flavor` is one of `claude`, `agnostic`.
- `conflict` is one of `prompt`, `overwrite`, `skip-if-exists`.
- `[detect].any_of` has at least one entry, all repo-relative.
- `version` is valid semver.
- `requires.entries` reference existing catalog entries.

A failing entry is hidden from `list`/`add` and `doctor` reports it as
malformed.

## Capability scoping (deferred)

ADR-0001 mentioned per-plugin capability declarations as a future
trust-surface mechanism. In v1, a catalog entry can write only the
`target` paths it declares in `[[provides]]` — that *is* the capability
scope. There is no separate capability list to keep in sync. If a
future plugin model needs declared but-not-yet-written capabilities,
that's a follow-up ADR.

## What this schema does *not* express

- **No remote sources.** All entries live in this repo. No URLs in
  `source`. (See ADR-0001 — no curl-pipe-bash.)
- **No package signing.** v1 trusts the repo's own commit history.
- **No template variable substitution.** Files are copied byte-for-byte.
  Placeholder content is encoded *inside* the source file (the
  `> *Example: ...*` quote-block convention from `content/templates/`).
- **No order-of-install dependencies beyond `requires.entries`.** If two
  entries provide overlapping targets, the user resolves the conflict
  per the per-file `conflict` policy.
