import { createRequire } from "node:module";
import consistencyDimension from "./dimensions/consistency.js";
import contextDimension from "./dimensions/context.js";
import costDimension from "./dimensions/cost.js";
import feedbackDimension from "./dimensions/feedback.js";
import latencyDimension from "./dimensions/latency.js";
import safetyDimension from "./dimensions/safety.js";
import agentGuidancePresentFixer from "./fixers/agent-guidance-present.js";
import docsReadmePresentFixer from "./fixers/docs-readme-present.js";
import editorconfigPresentFixer from "./fixers/editorconfig-present.js";
import gitignoreComprehensiveFixer from "./fixers/gitignore-comprehensive.js";
import agentGuidanceNested from "./probes/agent-guidance-nested.js";
import agentGuidancePresent from "./probes/agent-guidance-present.js";
import agentGuidanceQuality from "./probes/agent-guidance-quality.js";
import agentGuidanceSubstance from "./probes/agent-guidance-substance.js";
import archBoundariesClear from "./probes/arch-boundaries-clear.js";
import archDocPresent from "./probes/arch-doc-present.js";
import archDocQuality from "./probes/arch-doc-quality.js";
import archFitnessTestsConfigured from "./probes/arch-fitness-tests-configured.js";
import changelogStrategyDeclared from "./probes/changelog-strategy-declared.js";
import ciConfigured from "./probes/ci-configured.js";
import ciRunsTests from "./probes/ci-runs-tests.js";
import commitsConventionalFollowed from "./probes/commits-conventional-followed.js";
import docsAdrPresence from "./probes/docs-adr-presence.js";
import docsAdrQuality from "./probes/docs-adr-quality.js";
import docsContributingPresent from "./probes/docs-contributing-present.js";
import docsReadmeClarity from "./probes/docs-readme-clarity.js";
import docsReadmePresent from "./probes/docs-readme-present.js";
import docsReadmeSubstance from "./probes/docs-readme-substance.js";
import editorconfigPresent from "./probes/editorconfig-present.js";
import errorsActionability from "./probes/errors-actionability.js";
import formatClean from "./probes/format-clean.js";
import formatConfigured from "./probes/format-configured.js";
import gitBranchProtection from "./probes/git-branch-protection.js";
import gitignoreComprehensive from "./probes/gitignore-comprehensive.js";
import hooksGatesLintTestBuild from "./probes/hooks-gates-lint-test-build.js";
import hooksPrecommitPresent from "./probes/hooks-precommit-present.js";
import latencyBuild from "./probes/latency-build.js";
import latencyLint from "./probes/latency-lint.js";
import latencyTestSuite from "./probes/latency-test-suite.js";
import latencyTypecheck from "./probes/latency-typecheck.js";
import lintClean from "./probes/lint-clean.js";
import lintConfigured from "./probes/lint-configured.js";
import runtimeDevLoopBootable from "./probes/runtime-dev-loop-bootable.js";
import safetyDangerousScriptFlags from "./probes/safety-dangerous-script-flags.js";
import secretsDotenvGitignored from "./probes/secrets-dotenv-gitignored.js";
import secretsPrecommitScanConfigured from "./probes/secrets-precommit-scan-configured.js";
import sizeDirectoryDepth from "./probes/size-directory-depth.js";
import sizeLargeFiles from "./probes/size-large-files.js";
import sizeRepoTokenEstimate from "./probes/size-repo-token-estimate.js";
import specsPresent from "./probes/specs-present.js";
import specsQuality from "./probes/specs-quality.js";
import testsCoverPublicSurface from "./probes/tests-cover-public-surface.js";
import testsRunnerConfigured from "./probes/tests-runner-configured.js";
import typesClean from "./probes/types-clean.js";
import typesConfigured from "./probes/types-configured.js";

const pkg = createRequire(import.meta.url)("../package.json") as { name: string; version: string };

export const meta = {
  name: pkg.name,
  version: pkg.version,
};

export const probes = [
  agentGuidanceNested,
  agentGuidancePresent,
  agentGuidanceQuality,
  agentGuidanceSubstance,
  archBoundariesClear,
  archDocPresent,
  archDocQuality,
  archFitnessTestsConfigured,
  changelogStrategyDeclared,
  ciConfigured,
  ciRunsTests,
  commitsConventionalFollowed,
  docsAdrPresence,
  docsAdrQuality,
  docsContributingPresent,
  docsReadmeClarity,
  docsReadmePresent,
  docsReadmeSubstance,
  editorconfigPresent,
  errorsActionability,
  formatClean,
  formatConfigured,
  gitBranchProtection,
  gitignoreComprehensive,
  hooksGatesLintTestBuild,
  hooksPrecommitPresent,
  latencyBuild,
  latencyLint,
  latencyTestSuite,
  latencyTypecheck,
  lintClean,
  lintConfigured,
  runtimeDevLoopBootable,
  safetyDangerousScriptFlags,
  secretsDotenvGitignored,
  secretsPrecommitScanConfigured,
  sizeDirectoryDepth,
  sizeLargeFiles,
  sizeRepoTokenEstimate,
  specsPresent,
  specsQuality,
  testsCoverPublicSurface,
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

export const fixers = [
  agentGuidancePresentFixer,
  docsReadmePresentFixer,
  editorconfigPresentFixer,
  gitignoreComprehensiveFixer,
];
