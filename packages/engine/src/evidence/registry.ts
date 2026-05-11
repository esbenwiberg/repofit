import type { EvidenceMap, GatherContext } from "../sdk/types.js";
import { agentConfigSubsystem } from "./subsystems/agent-config.js";
import { ciWorkflowsSubsystem } from "./subsystems/ci-workflows.js";
import { commandsSubsystem } from "./subsystems/commands.js";
import { commitHistorySubsystem } from "./subsystems/commit-history.js";
import { filesSubsystem } from "./subsystems/files.js";
import { githubApiSubsystem } from "./subsystems/github-api.js";
import { gitignoreSubsystem } from "./subsystems/gitignore.js";
import { nodePackageSubsystem } from "./subsystems/node-package.js";
import { sizeStatsSubsystem } from "./subsystems/size-stats.js";

export async function gatherAll(ctx: GatherContext): Promise<EvidenceMap> {
  const [files, agentConfig, nodePackage, gitignore, sizeStats, ciWorkflows, commitHistory] =
    await Promise.all([
      filesSubsystem.gather(ctx),
      agentConfigSubsystem.gather(ctx),
      nodePackageSubsystem.gather(ctx),
      gitignoreSubsystem.gather(ctx),
      sizeStatsSubsystem.gather(ctx),
      ciWorkflowsSubsystem.gather(ctx),
      commitHistorySubsystem.gather(ctx),
    ]);
  return {
    files,
    agent_config: agentConfig,
    node_package: nodePackage,
    gitignore,
    size_stats: sizeStats,
    ci_workflows: ciWorkflows,
    commit_history: commitHistory,
    commands: commandsSubsystem.gather(ctx),
    github_api: githubApiSubsystem.gather(ctx),
  };
}
