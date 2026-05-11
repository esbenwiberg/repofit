import consistencyDimension from "./dimensions/consistency.js";
import contextDimension from "./dimensions/context.js";
import costDimension from "./dimensions/cost.js";
import feedbackDimension from "./dimensions/feedback.js";
import latencyDimension from "./dimensions/latency.js";
import safetyDimension from "./dimensions/safety.js";
import agentGuidancePresent from "./probes/agent-guidance-present.js";
import agentGuidanceSubstance from "./probes/agent-guidance-substance.js";
import changelogStrategyDeclared from "./probes/changelog-strategy-declared.js";
import ciRunsTests from "./probes/ci-runs-tests.js";
import commitsConventionalFollowed from "./probes/commits-conventional-followed.js";
import docsAdrPresence from "./probes/docs-adr-presence.js";
import docsContributingPresent from "./probes/docs-contributing-present.js";
import docsReadmePresent from "./probes/docs-readme-present.js";
import docsReadmeSubstance from "./probes/docs-readme-substance.js";
import editorconfigPresent from "./probes/editorconfig-present.js";
import formatClean from "./probes/format-clean.js";
import formatConfigured from "./probes/format-configured.js";
import gitBranchProtection from "./probes/git-branch-protection.js";
import gitignoreComprehensive from "./probes/gitignore-comprehensive.js";
import hooksPrecommitPresent from "./probes/hooks-precommit-present.js";
import latencyBuild from "./probes/latency-build.js";
import latencyLint from "./probes/latency-lint.js";
import latencyTestSuite from "./probes/latency-test-suite.js";
import latencyTypecheck from "./probes/latency-typecheck.js";
import lintClean from "./probes/lint-clean.js";
import lintConfigured from "./probes/lint-configured.js";
import safetyDangerousScriptFlags from "./probes/safety-dangerous-script-flags.js";
import secretsDotenvGitignored from "./probes/secrets-dotenv-gitignored.js";
import secretsPrecommitScanConfigured from "./probes/secrets-precommit-scan-configured.js";
import sizeDirectoryDepth from "./probes/size-directory-depth.js";
import sizeLargeFiles from "./probes/size-large-files.js";
import sizeRepoTokenEstimate from "./probes/size-repo-token-estimate.js";
import testsRunnerConfigured from "./probes/tests-runner-configured.js";
import typesClean from "./probes/types-clean.js";
import typesConfigured from "./probes/types-configured.js";

export const meta = {
  name: "@esbenwiberg/corpus-default",
  version: "0.0.0",
};

export const probes = [
  agentGuidancePresent,
  agentGuidanceSubstance,
  changelogStrategyDeclared,
  ciRunsTests,
  commitsConventionalFollowed,
  docsAdrPresence,
  docsContributingPresent,
  docsReadmePresent,
  docsReadmeSubstance,
  editorconfigPresent,
  formatClean,
  formatConfigured,
  gitBranchProtection,
  gitignoreComprehensive,
  hooksPrecommitPresent,
  latencyBuild,
  latencyLint,
  latencyTestSuite,
  latencyTypecheck,
  lintClean,
  lintConfigured,
  safetyDangerousScriptFlags,
  secretsDotenvGitignored,
  secretsPrecommitScanConfigured,
  sizeDirectoryDepth,
  sizeLargeFiles,
  sizeRepoTokenEstimate,
  testsRunnerConfigured,
  typesClean,
  typesConfigured,
];

export const dimensions = [
  contextDimension,
  consistencyDimension,
  costDimension,
  feedbackDimension,
  latencyDimension,
  safetyDimension,
];
