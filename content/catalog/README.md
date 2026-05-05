# content/catalog/

The declarative manifest of what `agentry list` exposes and what
`agentry add` / `upgrade --check` operate on.

Post-ADR-0005 the bundled catalog ships **practices only** — markdown
guidance the agent reads and adapts. Byte-perfect team artifacts live in
overlays registered via `agentry.overlays.toml`.

## Layout

One TOML file per entry. Filename equals the entry's `id`. The CLI
globs `*.toml` to enumerate entries; there is no separate index file.

```
content/catalog/
  schema.md            ← the contract every entry follows
  README.md            ← this file
  commits.toml
  code-review.toml
  git-hooks.toml
  pull-requests.toml
  ship.toml
```

## Current entries (all `kind = "practice"`)

| ID | Description |
|---|---|
| [`commits`](commits.toml) | Structured commit format (conventional / gitmoji / jira-prefix), how to choose, what good looks like. |
| [`code-review`](code-review.toml) | Prioritised diff review (Critical/High/Medium/Low), structured findings, verdict line. |
| [`git-hooks`](git-hooks.toml) | Choosing a hook strategy (raw `.githooks` / husky / lefthook / pre-commit), writing hooks teams keep. |
| [`pull-requests`](pull-requests.toml) | What/Why/How PRs with a Test plan; conventional-commit titles; provider notes (`gh` / GitLab / ADO). |
| [`ship`](ship.toml) | End-to-end orchestrator (commit → review → PR). Read alongside `commits` / `code-review` / `pull-requests`. |

Bundled practices intentionally cover universal workflows. Anything
team-specific (a particular changelog technique, a specific commit-msg
hook script, an ADR template) belongs in an overlay, not here.

## Schema

See [schema.md](schema.md) for the field-by-field contract. Locked by
[ADR-0002](../../docs/adr/0002-catalog-schema.md); `kind` discriminator
added by [ADR-0005](../../docs/adr/0005-scan-driven-core-catalog-as-practices.md).

Quick shape — practice entry:

```toml
id          = "commits"
name        = "Commit workflow"
description = "..."
version     = "1.0.0"
kind        = "practice"
practice    = "practices/commits.md"   # under content/, inlined into briefs

layers = ["harness", "conventions"]

[requires]
git   = true
tools = []
```

Quick shape — artifact entry (overlays only, post-ADR-0005):

```toml
id          = "..."
name        = "..."
description = "..."
version     = "0.1.0"
kind        = "artifact"

layers = ["harness", "conventions"]

[[provides]]
source   = "skills/.../skill.md"           # under overlay root
target   = ".claude/skills/.../skill.md"   # under target repo
flavor   = "claude"                        # claude | agnostic
conflict = "prompt"                        # prompt | overwrite | skip-if-exists

[detect]
any_of = ["..."]                           # paths that signal "installed"

[requires]
git     = true
entries = []                               # other catalog entry ids
tools   = []                               # external CLIs (soft check)
```

## How `agentry` consumes the catalog

- **`agentry list`** — reads every `*.toml`, filters out `deprecated_by`
  entries, prints id + name + description with a `[practice]` /
  `[overlay:<id>]` tag.
- **`agentry brief`** — inlines every `kind = "practice"` doc into
  `instructions.md` so the agent has guidance available verbatim.
- **`agentry add <id>`** — only valid for `kind = "artifact"` entries
  (overlays). Reads the entry, validates `requires`, copies each
  `[[provides]]` from the overlay root to `<target>` using its
  `conflict` policy.
- **`agentry upgrade --check`** — for installed artifact entries,
  classifies drift across the lockfile (`missing` / `out-of-date` /
  `user-edit` / `orphaned`).
- **`agentry coach <kind>`** — bypasses the catalog; bespoke scaffolding
  for things that can't be installed (CLAUDE.md, ADRs, specs, agent
  profile).

## Adding a new bundled practice

1. Pick an `id` (kebab-case, stable forever).
2. Create `content/catalog/<id>.toml` with `kind = "practice"` and a
   `practice` field pointing at a markdown file under `content/`.
3. Author the practice doc — universal, tool-agnostic, no team-specific
   prescriptions. If it only fits one team, it belongs in an overlay.
4. Document the entry in this README's table.
5. Commit (`feat(catalog)`).

## What this catalog does *not* support

- Remote sources (URLs in `source`). Bundled content lives in this repo;
  overlay content lives under each overlay's root.
- Template variable substitution. Files are copied byte-for-byte;
  placeholders live inside the source file.
- Markdown merging. Existing target files are kept, overwritten, or
  prompted on — never auto-merged.
- Team-specific prescriptions. Push those to overlays.
