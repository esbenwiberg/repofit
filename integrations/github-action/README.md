# repofit GitHub Action

A composite GitHub Action that runs [`@esbenwiberg/repofit`](https://www.npmjs.com/package/@esbenwiberg/repofit)
in CI, gates the pull request against the committed baseline, and uploads the
JSON and HTML reports as workflow artifacts.

## Quickstart

Add `.github/workflows/repofit.yml` to your repo:

```yaml
name: repofit

on:
  pull_request:
  push:
    branches: [main]

jobs:
  repofit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: esbenwiberg/repofit/integrations/github-action@v1
```

That's it. The action installs Node 22, runs `repofit check --ci`, fails the
job on hard gate failures, and uploads `repofit-report.json` +
`repofit-report.html` as artifacts.

> The action assumes you've already committed `repofit.config.json` and
> `repofit-baseline.json`. Run `npx @esbenwiberg/repofit --init` and
> `npx @esbenwiberg/repofit --accept` locally first, then commit both files.

## Inputs

| Name               | Default                | Description                                                                  |
| ------------------ | ---------------------- | ---------------------------------------------------------------------------- |
| `version`          | `latest`               | Version of `@esbenwiberg/repofit` to install. e.g. `1.0.0`, `^1`, `latest`.  |
| `node-version`     | `22`                   | Node.js version to use. repofit requires Node 22+.                           |
| `cwd`              | `${{ github.workspace }}` | Working directory to run repofit against.                                 |
| `include`          | *(empty)*              | Comma-separated opt-in tiers: `executed`, `reasoned`, or both.               |
| `artifact`         | `repofit-report.json`  | Path to write the JSON report to (relative to `cwd`).                        |
| `html`             | `repofit-report.html`  | Path to write the HTML report to. Set to `""` to skip.                       |
| `sarif`            | `repofit-report.sarif` | Path to write the SARIF 2.1.0 report to. Set to `""` to skip.                |
| `upload-sarif`     | `true`                 | Upload the SARIF report to GitHub code scanning.                             |
| `sarif-category`   | `repofit`              | SARIF category — lets multiple repofit runs coexist per PR.                  |
| `comment`          | `repofit-comment.md`   | Path to write the markdown PR-comment body. Set to `""` to skip.             |
| `post-comment`     | `true`                 | Post the markdown as a sticky PR comment. Requires `pull-requests: write`.   |
| `comment-header`   | `repofit`              | Header that uniquely identifies the sticky comment.                          |
| `upload-artifacts` | `true`                 | Whether to upload the JSON/HTML reports as workflow artifacts.               |
| `fail-on`          | `error`                | Verdict severity that fails the job: `warn` \| `error` \| `never`.           |

### PR sticky comment

By default, the action posts a sticky comment on the PR with the verdict,
score delta, dimension table, and top regressions. The comment updates in
place on every push (one per `comment-header`, so you can have multiple
repofit configurations side-by-side).

Requires `pull-requests: write`:

```yaml
jobs:
  repofit:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: esbenwiberg/repofit/integrations/github-action@v1
```

Set `post-comment: false` to skip posting (the markdown is still written to
disk and uploaded as an artifact).

### SARIF + GitHub code scanning

By default, the action uploads a SARIF report to GitHub Advanced Security (code
scanning). Findings appear inline on the PR diff at the probe's location
(rather than buried in a workflow log). To enable this, your repo needs:

- The `Security events: write` permission (set on the job, or via repo-default
  workflow permissions).
- GitHub Advanced Security enabled on the repo (free for public repos; paid
  add-on for private).

```yaml
jobs:
  repofit:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write    # required for code-scanning upload
    steps:
      - uses: actions/checkout@v4
      - uses: esbenwiberg/repofit/integrations/github-action@v1
```

If your repo doesn't have code scanning enabled, the upload step is `continue-on-error`,
so the job still succeeds — only the inline annotations are missing. Set
`upload-sarif: false` to skip the upload entirely.

### `fail-on` semantics

repofit emits exit codes from `--ci`:

- `0` — pass
- `1` — drift / advisory (informational regression below the hard threshold)
- `2` — hard gate failure

| `fail-on` | Action fails when …                                          |
| --------- | ------------------------------------------------------------ |
| `never`   | never. Reports are produced and uploaded; job is always green. |
| `error`   | repofit returns exit code 2 or higher (hard gate failure).     |
| `warn`    | repofit returns any non-zero exit code (drift + failures).     |

## Outputs

| Name          | Description                                                |
| ------------- | ---------------------------------------------------------- |
| `fitness`     | Overall fitness score (0–100), parsed from the JSON report.|
| `verdict`     | `pass`, `drift`, `fail`, or `unknown`.                     |
| `report-json` | Path to the JSON report (relative to working directory).   |
| `report-html` | Path to the HTML report (relative to working directory).   |

## Examples

### Comment the score on the PR

```yaml
- name: repofit
  id: repofit
  uses: esbenwiberg/repofit/integrations/github-action@v1

- name: Comment on PR
  if: github.event_name == 'pull_request' && always()
  uses: marocchino/sticky-pull-request-comment@v2
  with:
    header: repofit
    message: |
      **repofit:** ${{ steps.repofit.outputs.verdict }} ·
      fitness **${{ steps.repofit.outputs.fitness }}** /100 ·
      [JSON report](../artifacts) · [HTML report](../artifacts)
```

### Opt into the executed tier (slow probes)

```yaml
- uses: esbenwiberg/repofit/integrations/github-action@v1
  with:
    include: executed
```

This runs latency-tier probes (test/build/lint wall-clock). Expect the job to
take ~1–3 minutes longer.

### Run on a subdirectory

```yaml
- uses: esbenwiberg/repofit/integrations/github-action@v1
  with:
    cwd: packages/web
```

### Advisory-only mode

```yaml
- uses: esbenwiberg/repofit/integrations/github-action@v1
  with:
    fail-on: never
```

Useful for the first weeks after wiring repofit up — surface the score and
artifacts without blocking merges.

## Pinning the action

`@v1` follows the latest 1.x tag. To pin to an exact commit (recommended for
supply-chain hygiene), use the full SHA:

```yaml
uses: esbenwiberg/repofit/integrations/github-action@<sha>
```

## See also

- [repofit CLI docs](https://github.com/esbenwiberg/repofit#readme)
- [Authoring custom probes](https://github.com/esbenwiberg/repofit/blob/main/docs/authoring.md)
- [Azure DevOps integration](../azure-pipelines/README.md)
