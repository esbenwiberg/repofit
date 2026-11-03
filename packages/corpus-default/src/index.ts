import { createRequire } from "node:module";
import consistencyDimension from "./dimensions/consistency.js";
import contextDimension from "./dimensions/context.js";
import costDimension from "./dimensions/cost.js";
import feedbackDimension from "./dimensions/feedback.js";
import latencyDimension from "./dimensions/latency.js";
import safetyDimension from "./dimensions/safety.js";
import agentGuidancePresentFixer from "./fixers/agent-guidance-present.js";
import agentGuidancePresentLlmFixer from "./fixers/agent-guidance-present-llm.js";
import agentLocalSettingsNotCommittedFixer from "./fixers/agent-local-settings-not-committed.js";
import docsReadmePresentFixer from "./fixers/docs-readme-present.js";
import docsReadmePresentLlmFixer from "./fixers/docs-readme-present-llm.js";
import editorconfigPresentFixer from "./fixers/editorconfig-present.js";
import gitignoreComprehensiveFixer from "./fixers/gitignore-comprehensive.js";
import agentCommandsResolve from "./probes/agent-commands-resolve.js";
import agentGuidanceAligned from "./probes/agent-guidance-aligned.js";
import agentGuidanceFresh from "./probes/agent-guidance-fresh.js";
import agentGuidancePresent from "./probes/agent-guidance-present.js";
import agentGuidanceQuality from "./probes/agent-guidance-quality.js";
import agentHarnessAdaptersThin from "./probes/agent-harness-adapters-thin.js";
import agentLocalSettingsNotCommitted from "./probes/agent-local-settings-not-committed.js";
import agentNestedGuidanceLean from "./probes/agent-nested-guidance-lean.js";
import agentReferencesResolve from "./probes/agent-references-resolve.js";
import agentRootBudget from "./probes/agent-root-budget.js";
import agentRootRoutes from "./probes/agent-root-routes.js";
import agentSharedFilesPortable from "./probes/agent-shared-files-portable.js";
import agentSkillDescriptionsTrigger from "./probes/agent-skill-descriptions-trigger.js";
import agentSkillEvalsPresent from "./probes/agent-skill-evals-present.js";
import agentSkillsPresent from "./probes/agent-skills-present.js";
import agentSkillsQuality from "./probes/agent-skills-quality.js";
import agentSkillsSingleSource from "./probes/agent-skills-single-source.js";
import archBoundariesClear from "./probes/arch-boundaries-clear.js";
import archCouplingHotspots from "./probes/arch-coupling-hotspots.js";
import archDocPresent from "./probes/arch-doc-present.js";
import archDocQuality from "./probes/arch-doc-quality.js";
import archFitnessTestsConfigured from "./probes/arch-fitness-tests-configured.js";
import buildClean from "./probes/build-clean.js";
import buildConfigured from "./probes/build-configured.js";
import changelogStrategyDeclared from "./probes/changelog-strategy-declared.js";
import ciConfigured from "./probes/ci-configured.js";
import ciRunsBuild from "./probes/ci-runs-build.js";
import ciRunsLint from "./probes/ci-runs-lint.js";
import ciRunsTests from "./probes/ci-runs-tests.js";
import ciRunsTypecheck from "./probes/ci-runs-typecheck.js";
import commitsConventionalFollowed from "./probes/commits-conventional-followed.js";
import contractsMachineReadable from "./probes/contracts-machine-readable.js";
import deadCodeConfigured from "./probes/dead-code-configured.js";
import depsAuditConfigured from "./probes/deps-audit-configured.js";
import depsLockfilePresent from "./probes/deps-lockfile-present.js";
import docsAdrPresence from "./probes/docs-adr-presence.js";
import docsAdrQuality from "./probes/docs-adr-quality.js";
import docsContributingPresent from "./probes/docs-contributing-present.js";
import docsLinksResolved from "./probes/docs-links-resolved.js";
import docsReadmeClarity from "./probes/docs-readme-clarity.js";
import docsReadmePresent from "./probes/docs-readme-present.js";
import docsReadmeSubstance from "./probes/docs-readme-substance.js";
import editorconfigPresent from "./probes/editorconfig-present.js";
import errorsActionability from "./probes/errors-actionability.js";
import formatClean from "./probes/format-clean.js";
import formatConfigured from "./probes/format-configured.js";
import generatedCodeMarked from "./probes/generated-code-marked.js";
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
import readmeCommandsRunnable from "./probes/readme-commands-runnable.js";
import runtimeDevLoopBootable from "./probes/runtime-dev-loop-bootable.js";
import safetyDangerousScriptFlags from "./probes/safety-dangerous-script-flags.js";
import secretsDotenvGitignored from "./probes/secrets-dotenv-gitignored.js";
import secretsPrecommitScanConfigured from "./probes/secrets-precommit-scan-configured.js";
import secretsScanClean from "./probes/secrets-scan-clean.js";
import sizeDirectoryDepth from "./probes/size-directory-depth.js";
import sizeLargeFiles from "./probes/size-large-files.js";
import sizeRepoTokenEstimate from "./probes/size-repo-token-estimate.js";
import specsPresent from "./probes/specs-present.js";
import specsQuality from "./probes/specs-quality.js";
import specsTestTraceability from "./probes/specs-test-traceability.js";
import testsAgentSafeCommand from "./probes/tests-agent-safe-command.js";
import testsClean from "./probes/tests-clean.js";
import testsCoverPublicSurface from "./probes/tests-cover-public-surface.js";
import testsDeterministic from "./probes/tests-deterministic.js";
import testsFailureActionability from "./probes/tests-failure-actionability.js";
import testsMutationConfigured from "./probes/tests-mutation-configured.js";
import testsOracleQuality from "./probes/tests-oracle-quality.js";
import testsRunnerConfigured from "./probes/tests-runner-configured.js";
import typesClean from "./probes/types-clean.js";
import typesConfigured from "./probes/types-configured.js";
import typesEscapeHatches from "./probes/types-escape-hatches.js";

const pkg = createRequire(import.meta.url)("../package.json") as { name: string; version: string };

export const meta = {
  name: pkg.name,
  version: pkg.version,
};

export const probes = [
  agentCommandsResolve,
  agentGuidanceAligned,
  agentGuidanceFresh,
  agentGuidancePresent,
  agentGuidanceQuality,
  agentHarnessAdaptersThin,
  agentLocalSettingsNotCommitted,
  agentNestedGuidanceLean,
  agentReferencesResolve,
  agentRootBudget,
  agentRootRoutes,
  agentSharedFilesPortable,
  agentSkillDescriptionsTrigger,
  agentSkillEvalsPresent,
  agentSkillsPresent,
  agentSkillsQuality,
  agentSkillsSingleSource,
  archBoundariesClear,
  archCouplingHotspots,
  archDocPresent,
  archDocQuality,
  archFitnessTestsConfigured,
  buildClean,
  buildConfigured,
  changelogStrategyDeclared,
  ciConfigured,
  ciRunsBuild,
  ciRunsLint,
  ciRunsTests,
  ciRunsTypecheck,
  commitsConventionalFollowed,
  contractsMachineReadable,
  deadCodeConfigured,
  depsAuditConfigured,
  depsLockfilePresent,
  docsAdrPresence,
  docsAdrQuality,
  docsContributingPresent,
  docsLinksResolved,
  docsReadmeClarity,
  docsReadmePresent,
  docsReadmeSubstance,
  editorconfigPresent,
  errorsActionability,
  formatClean,
  formatConfigured,
  generatedCodeMarked,
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
  readmeCommandsRunnable,
  runtimeDevLoopBootable,
  safetyDangerousScriptFlags,
  secretsDotenvGitignored,
  secretsPrecommitScanConfigured,
  secretsScanClean,
  sizeDirectoryDepth,
  sizeLargeFiles,
  sizeRepoTokenEstimate,
  specsPresent,
  specsQuality,
  specsTestTraceability,
  testsAgentSafeCommand,
  testsClean,
  testsCoverPublicSurface,
  testsDeterministic,
  testsFailureActionability,
  testsMutationConfigured,
  testsOracleQuality,
  testsRunnerConfigured,
  typesClean,
  typesConfigured,
  typesEscapeHatches,
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
  agentGuidancePresentLlmFixer,
  agentLocalSettingsNotCommittedFixer,
  docsReadmePresentFixer,
  docsReadmePresentLlmFixer,
  editorconfigPresentFixer,
  gitignoreComprehensiveFixer,
];

/**
 * Probe ids earlier corpus versions shipped, with the probe that now
 * covers the same ground (`null` when nothing does). The engine warns
 * when a config still references one.
 */
export const retired: Record<string, string | null> = {
  "agent.guidance-substance": "agent.root-budget",
  "agent.guidance-nested": "agent.nested-guidance-lean",
};
