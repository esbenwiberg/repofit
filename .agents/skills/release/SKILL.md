---
name: release
description: "Use when preparing a repofit package release: the full validation set, package contents, release notes under docs/release and the release commit. Not for day-to-day commits."
---
# Release

**Why this exists:** A publish from a dirty tree, a semver range in a corpus pin, or a release with no note under docs/release.

1. Read the latest release note under `docs/release/`.
2. Run the full validation set:

```bash
npm run typecheck
npm run lint
npm test
npm run build
node packages/engine/dist/cli/index.js --version
```

3. Check package contents before publishing:

```bash
npm pack --workspace @esbenwiberg/repofit --dry-run
npm pack --workspace @esbenwiberg/corpus-default --dry-run
```

4. Write release notes under `docs/release/`, not `CHANGELOG.md`.
5. Commit with `chore(release): ...` or `docs(release): ...`, depending on the change.

Guardrails:
- Do not publish from a dirty tree.
- Do not use semver ranges in `repofit.config.json` corpus pins.
- Do not skip the secret scan hook.
