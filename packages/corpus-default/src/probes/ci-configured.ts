import { defineProbe } from "@esbenwiberg/repofit/sdk";

const CI_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "GitHub Actions", pattern: /^\.github\/workflows\/[^/]+\.ya?ml$/i },
  { name: "GitLab CI", pattern: /^\.gitlab-ci\.ya?ml$/i },
  { name: "CircleCI", pattern: /^\.circleci\/config\.ya?ml$/i },
  { name: "Azure Pipelines", pattern: /^(?:\.?)azure-pipelines(?:\.[^/]+)?\.ya?ml$/i },
  { name: "Azure Pipelines", pattern: /^\.azure-pipelines\/[^/]+\.ya?ml$/i },
  { name: "Bitbucket Pipelines", pattern: /^bitbucket-pipelines\.ya?ml$/i },
  { name: "Jenkins", pattern: /^Jenkinsfile$/ },
  { name: "Travis CI", pattern: /^\.travis\.ya?ml$/i },
  { name: "Buildkite", pattern: /^\.buildkite\/pipeline\.ya?ml$/i },
  { name: "Drone", pattern: /^\.drone\.ya?ml$/i },
  { name: "AppVeyor", pattern: /^\.?appveyor\.ya?ml$/i },
  { name: "Woodpecker", pattern: /^\.woodpecker\.ya?ml$/i },
];

export default defineProbe({
  id: "ci.configured",
  version: "1.0.0",
  dimensions: [{ id: "feedback", weight: 1 }],
  tier: "static",
  evidence: ["size_stats"],

  rationale: `
    Continuous integration is how an agent's changes get verified against
    the full test + lint + build surface on a clean machine. A repo
    without any CI config is one where regressions only surface after a
    human pulls the branch. This probe detects configuration for the
    common CI systems: GitHub Actions, GitLab CI, CircleCI, Azure
    Pipelines, Bitbucket Pipelines, Jenkins, Travis CI, Buildkite,
    Drone, AppVeyor, and Woodpecker.
  `,

  remediation:
    "Add a CI workflow that runs your test, lint, and build steps on every push. GitHub: `.github/workflows/ci.yml`. GitLab: `.gitlab-ci.yml`. Azure DevOps: `azure-pipelines.yml`. CircleCI: `.circleci/config.yml`. The shape doesn't matter as much as the gate — green-on-main means an agent can trust the tree.",

  async detect(ev) {
    for (const f of ev.size_stats.files) {
      if (CI_PATTERNS.some(({ pattern }) => pattern.test(f.path))) {
        return { kind: "predicate", value: true };
      }
    }
    return { kind: "predicate", value: false };
  },

  score: { kind: "predicate", direction: "positive" },

  fixtures: [
    {
      name: "no-ci",
      evidence: {
        size_stats: {
          source: "git-ls-files",
          totalBytes: 0,
          totalFiles: 0,
          files: [],
        },
      },
      expect: { reading: { kind: "predicate", value: false }, score: 0 },
    },
    {
      name: "github-actions",
      evidence: {
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 1,
          files: [{ path: ".github/workflows/ci.yml", bytes: 100, lines: 10, depth: 3 }],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "gitlab-ci",
      evidence: {
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 1,
          files: [{ path: ".gitlab-ci.yml", bytes: 100, lines: 10, depth: 0 }],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "azure-pipelines-root",
      evidence: {
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 1,
          files: [{ path: "azure-pipelines.yml", bytes: 100, lines: 10, depth: 0 }],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "azure-pipelines-subdir",
      evidence: {
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 1,
          files: [{ path: ".azure-pipelines/main.yml", bytes: 100, lines: 10, depth: 1 }],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "circleci",
      evidence: {
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 1,
          files: [{ path: ".circleci/config.yml", bytes: 100, lines: 10, depth: 1 }],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "jenkinsfile",
      evidence: {
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 1,
          files: [{ path: "Jenkinsfile", bytes: 100, lines: 10, depth: 0 }],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "bitbucket-pipelines",
      evidence: {
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 1,
          files: [{ path: "bitbucket-pipelines.yml", bytes: 100, lines: 10, depth: 0 }],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "travis",
      evidence: {
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 1,
          files: [{ path: ".travis.yml", bytes: 100, lines: 10, depth: 0 }],
        },
      },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "unrelated-yaml-not-detected",
      evidence: {
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 1,
          files: [{ path: "config.yml", bytes: 100, lines: 10, depth: 0 }],
        },
      },
      expect: { reading: { kind: "predicate", value: false }, score: 0 },
    },
  ],
});
