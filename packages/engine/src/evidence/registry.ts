import type { EvidenceMap, GatherContext } from "../sdk/types.js";
import { analyzeRepository } from "./structural/analysis.js";
import { agentConfigSubsystem } from "./subsystems/agent-config.js";
import { ciWorkflowsSubsystem } from "./subsystems/ci-workflows.js";
import { commandsSubsystem } from "./subsystems/commands.js";
import { commitHistorySubsystem } from "./subsystems/commit-history.js";
import { dotnetProjectSubsystem } from "./subsystems/dotnet-project.js";
import { filesSubsystem } from "./subsystems/files.js";
import { githubApiSubsystem } from "./subsystems/github-api.js";
import { gitignoreSubsystem } from "./subsystems/gitignore.js";
import { goModuleSubsystem } from "./subsystems/go-module.js";
import { judgeSubsystem } from "./subsystems/judge.js";
import { nodePackageSubsystem } from "./subsystems/node-package.js";
import { pythonProjectSubsystem } from "./subsystems/python-project.js";
import { sizeStatsSubsystem } from "./subsystems/size-stats.js";
import { resolve as resolveToolchain } from "./subsystems/toolchain.js";

export async function gatherAll(ctx: GatherContext): Promise<EvidenceMap> {
  const [
    files,
    agentConfig,
    nodePackage,
    pythonProject,
    dotnetProject,
    goModule,
    gitignore,
    sizeStats,
    ciWorkflows,
    commitHistory,
  ] = await Promise.all([
    filesSubsystem.gather(ctx),
    agentConfigSubsystem.gather(ctx),
    nodePackageSubsystem.gather(ctx),
    pythonProjectSubsystem.gather(ctx),
    dotnetProjectSubsystem.gather(ctx),
    goModuleSubsystem.gather(ctx),
    gitignoreSubsystem.gather(ctx),
    sizeStatsSubsystem.gather(ctx),
    ciWorkflowsSubsystem.gather(ctx),
    commitHistorySubsystem.gather(ctx),
  ]);
  const toolchain = resolveToolchain(ctx, {
    node: nodePackage,
    python: pythonProject,
    dotnet: dotnetProject,
    go: goModule,
  });
  let analysis: ReturnType<typeof analyzeRepository> | undefined;
  return {
    repo_analysis: { inspect: () => (analysis ??= analyzeRepository(ctx.cwd)) },
    files,
    agent_config: agentConfig,
    node_package: nodePackage,
    python_project: pythonProject,
    dotnet_project: dotnetProject,
    go_module: goModule,
    toolchain,
    gitignore,
    size_stats: sizeStats,
    ci_workflows: ciWorkflows,
    commit_history: commitHistory,
    commands: commandsSubsystem.gather(ctx),
    github_api: githubApiSubsystem.gather(ctx),
    judge: judgeSubsystem.gather(ctx),
  };
}
