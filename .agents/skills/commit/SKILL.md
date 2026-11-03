---
name: commit
description: "Use when preparing a commit in this repository: focused verification per workspace, lint, staging only your own files, and a Conventional Commit subject. Not for release tagging."
---
# Commit

**Why this exists:** A commit that skipped the workspace's own typecheck and tests, staged someone else's work or a report from /private/tmp, or bypassed the hooks with --no-verify.

1. Check the working tree:

```bash
git status --short
```

2. Run focused verification for the files changed; each command must exit 0. For corpus changes, use:

```bash
npm run build -w @esbenwiberg/repofit
npm --workspace @esbenwiberg/corpus-default run typecheck
npm --workspace @esbenwiberg/corpus-default test
```

For engine changes, use:

```bash
npm --workspace @esbenwiberg/repofit run typecheck
npm --workspace @esbenwiberg/repofit test
```

3. Always run:

```bash
npm run lint
```

4. Stage only intended files.
5. Commit using `type(scope): subject`, for example `feat(corpus): add test oracle probe`.

Guardrails:
- Do not use `--no-verify`.
- Do not stage unrelated user changes.
- If generated reports live under `/private/tmp`, do not commit them.
