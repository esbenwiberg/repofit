# repofit for Azure DevOps Pipelines

A reusable step template that runs [`@esbenwiberg/repofit`](https://www.npmjs.com/package/@esbenwiberg/repofit)
in Azure DevOps, gates the PR against the committed baseline, and publishes the
JSON and HTML reports as pipeline artifacts.

## Quickstart (same-repo)

If your code lives in the same repo as the template:

```yaml
# azure-pipelines.yml
trigger:
  - main

pr:
  - main

pool:
  vmImage: ubuntu-latest

steps:
  - checkout: self

  - template: integrations/azure-pipelines/repofit.yml
```

That's it. The step installs Node 22, runs `repofit check --ci`, fails the
job on hard gate failures, and publishes `repofit-report.json` +
`repofit-report.html` as pipeline artifacts.

> The template assumes you've already committed `repofit.config.json` and
> `repofit-baseline.json`. Run `npx @esbenwiberg/repofit --init` and
> `npx @esbenwiberg/repofit --accept` locally first, then commit both files.

## Quickstart (cross-repo)

If your code is in a different repo and you want to pull the template from
`esbenwiberg/repofit` directly:

```yaml
resources:
  repositories:
    - repository: repofit
      type: github
      name: esbenwiberg/repofit
      ref: refs/tags/v1.0.0           # pin to a tag (recommended)
      endpoint: <github-service-connection>

steps:
  - checkout: self

  - template: integrations/azure-pipelines/repofit.yml@repofit
    parameters:
      version: '1.0.0'
```

Replace `<github-service-connection>` with the name of an Azure DevOps service
connection that has read access to GitHub.

## Parameters

| Name               | Type    | Default                          | Description                                                                |
| ------------------ | ------- | -------------------------------- | -------------------------------------------------------------------------- |
| `version`          | string  | `latest`                         | Version of `@esbenwiberg/repofit` to install. e.g. `1.0.0`, `^1`, `latest`. |
| `nodeVersion`      | string  | `22`                             | Node.js version to install. repofit requires Node 22+.                     |
| `cwd`              | string  | `$(Build.SourcesDirectory)`      | Working directory to run repofit against.                                  |
| `include`          | string  | *(empty)*                        | Comma-separated opt-in tiers: `executed`, `reasoned`, or both.             |
| `artifact`         | string  | `repofit-report.json`            | Path to write the JSON report to (relative to `cwd`).                      |
| `html`             | string  | `repofit-report.html`            | Path to write the HTML report to. Set to `''` to skip.                     |
| `sarif`            | string  | `repofit-report.sarif`           | Path to write the SARIF 2.1.0 report. Set to `''` to skip.                 |
| `comment`          | string  | `repofit-comment.md`             | Path to write the markdown PR-comment body. Set to `''` to skip.           |
| `postComment`      | boolean | `true`                           | Post the rendered markdown as a PR comment (only fires on PR builds).      |
| `publishArtifacts` | boolean | `true`                           | Publish the JSON/HTML/SARIF reports as pipeline artifacts.                 |
| `artifactName`     | string  | `repofit-report`                 | Base name for the published artifacts (`-json` / `-html` are appended).    |
| `failOn`           | string  | `error`                          | When to fail the step: `warn` \| `error` \| `never`.                       |

### `failOn` semantics

repofit emits exit codes from `--ci`:

- `0` — pass
- `1` — drift / advisory (informational regression below the hard threshold)
- `2` — hard gate failure

| `failOn` | Step fails when …                                            |
| -------- | ------------------------------------------------------------ |
| `never`  | never. Reports are produced and published; step is always green. |
| `error`  | repofit returns exit code 2 or higher (hard gate failure).   |
| `warn`   | repofit returns any non-zero exit code (drift + failures).   |

## Output variables

The template sets the following output variables on the `run` and `parse`
steps. To consume them downstream, give the template's outer step an explicit
name and reference via `dependencies.<jobName>.outputs['<step>.<var>']` or, in
the same job, `$(parse.repofitFitness)`.

| Variable          | Set by  | Description                                      |
| ----------------- | ------- | ------------------------------------------------ |
| `repofitStatus`   | `run`   | The raw exit code from `repofit --ci`.           |
| `repofitFitness`  | `parse` | Overall fitness score (0–100).                   |
| `repofitVerdict`  | `parse` | `pass`, `drift`, `fail`, or `unknown`.           |

Example:

```yaml
steps:
  - template: integrations/azure-pipelines/repofit.yml

  - bash: |
      echo "fitness was $(parse.repofitFitness)"
      echo "verdict was $(parse.repofitVerdict)"
    displayName: read repofit outputs
```

## Examples

### Opt into the executed tier (slow probes)

```yaml
- template: integrations/azure-pipelines/repofit.yml
  parameters:
    include: executed
```

This runs latency-tier probes (test/build/lint wall-clock). Expect the job to
take ~1–3 minutes longer.

### Run on a subdirectory

```yaml
- template: integrations/azure-pipelines/repofit.yml
  parameters:
    cwd: $(Build.SourcesDirectory)/packages/web
```

### Advisory-only mode

```yaml
- template: integrations/azure-pipelines/repofit.yml
  parameters:
    failOn: never
```

Useful for the first weeks after wiring repofit up — surface the score and
artifacts without blocking merges.

## PR comments

When `postComment` is true (the default) and the build was triggered by a PR,
the template posts a comment with the score, dimension table, and top
regressions. This requires:

1. The build pipeline's identity has **Contribute to pull requests** permission
   on the target repo. (Project Settings → Repositories → your repo →
   Permissions → look for `<Project> Build Service` and grant it.)
2. `System.AccessToken` is available to the script step (the template wires
   `env: SYSTEM_ACCESSTOKEN: $(System.AccessToken)` automatically).

Skip posting with `postComment: false`. The markdown file is still produced
and (if `publishArtifacts` is true) published as an artifact.

## Notes

- The template assumes a Linux agent (uses `bash`). On Windows agents, replace
  the `bash:` steps with `pwsh:` or use the `ubuntu-latest` Microsoft-hosted pool.
- For self-hosted agents without internet, pre-install `@esbenwiberg/repofit`
  on the agent image (or use a private npm registry) and remove the `--yes`
  flag from `npx`.

## See also

- [repofit CLI docs](https://github.com/esbenwiberg/repofit#readme)
- [Authoring custom probes](https://github.com/esbenwiberg/repofit/blob/main/docs/authoring.md)
- [GitHub Action integration](../github-action/README.md)
