# Commit Workflow

Structured commit workflow: inspect, group, classify, propose, commit.

## When to use

- After completing a unit of work that's ready to commit.
- Before opening a pull request.
- When you have multiple unrelated changes staged and need to split them.

## Workflow

```
1. Inspect changes  →  2. Group + classify  →  3. Suggest plan  →
4. Stage + commit  →  5. Update changelog (if used)  →  6. Offer review/PR
```

## Steps

### 1. Inspect changes

```bash
git status --porcelain
git diff --stat
git diff               # for the smaller hunks
```

Note the file types, the directories touched, and any logical clusters.

### 2. Group changes into commits

A good commit is **one logical change**. Split when:

- Two changes have unrelated rationale (a bug fix and a refactor).
- One change is `feat`/`fix` and another is `chore`/`docs`/`test`.
- Reverting one would not affect the other.

Combine when:

- Files are co-changed for the same feature (handler + test + caller).
- Splitting would make either commit non-buildable.

### 3. Classify each commit

| Type | Use for | User-visible? |
|---|---|---|
| `feat` | New user-facing capability | yes |
| `fix` | Bug fix in shipped behaviour | yes |
| `refactor` | Internal restructuring, no behaviour change | yes |
| `perf` | Measurable performance improvement | yes |
| `breaking` | Backwards-incompatible change | yes |
| `security` | Security fix | yes |
| `build` | Build system / dependency change | yes |
| `test` | Test-only change | no |
| `docs` | Docs / README / comments only | no |
| `style` | Formatting only | no |
| `ci` | CI/CD config | no |
| `chore` | Tooling, dotfiles, configs that don't affect runtime | no |

The "user-visible?" column is what should land in release notes /
changelog if the project keeps one. Projects pick the changelog
mechanism that fits — see step 5.

**Heuristic for `chore`:** if the change is in `.github/`, `.githooks/`,
editor config, or developer tooling and **does not** affect what users
ship, it's `chore`.

### 4. Present the plan

Before executing, show the user the planned commits:

```
Commit 1: feat(api): add user authentication endpoint
  Files:
    - src/auth/login.ts
    - src/auth/login.test.ts
  Note: user-visible — record in changelog per project convention.

Commit 2: docs(readme): document new auth endpoint
  Files:
    - README.md
  Note: docs only — no changelog entry needed.
```

Ask: *Approve, modify, or split differently?* Don't proceed without consent.

### 4. Execute

```bash
git add src/auth/login.ts src/auth/login.test.ts
git commit -m "feat(api): add user authentication endpoint"
```

If the project's `commit-msg` hook rejects the commit, read the message
— usually it's a malformed subject or a missing prerequisite. Fix and
re-stage. **Never `--no-verify`** and don't `--amend` if the hook
failure means the commit didn't happen.

### 5. Update the changelog (if the project uses one)

Different projects use different mechanisms — pick the one that fits
this repo, don't impose. Common shapes:

| Mechanism | Where to look |
|---|---|
| Fragment-based (one file per change) | `.changes/`, `.changeset/` directories; helper script in `_scripts/` |
| Auto-generated from commits | `release-please`, `semantic-release`, `conventional-changelog` configs |
| Manually maintained | `CHANGELOG.md` at the root |
| Release-notes only | GitHub Releases / GitLab tags; nothing in the repo |
| None | Apps and internal tools often skip it |

If the project enforces a mechanism via `commit-msg` hook, do what the
hook expects and stage the changelog artifact alongside the code. If
unsure, ask before assuming.

### 6. Offer review and PR

After commits succeed, offer the user:

- A structured code review (see `code-review` skill).
- A pull request (see `pull-requests` skill).
- Or stop here.

## Subject rules

- Imperative mood: "add feature", not "added feature".
- Lowercase first letter (after the type prefix).
- No trailing period.
- Max ~72 chars (the hook allows up to 100).
- Specific. "fix bug" is not a commit subject.

## Breaking changes

Add `BREAKING CHANGE:` to the commit body. If the project keeps a
changelog, make sure the breaking change is recorded there too.

```
breaking(api): redesign auth flow

BREAKING CHANGE: POST /auth moved to POST /api/v2/auth.
Body changed from {user, pass} to {username, password}.
```

## Anti-patterns

- ❌ Commits with >10 files unless they truly belong together.
- ❌ Mixed feat + fix + refactor in one commit.
- ❌ "WIP", "changes", "updates" as subjects.
- ❌ Bypassing hooks with `--no-verify`.

## Spec

Full rules: [`rules.md`](rules.md).
