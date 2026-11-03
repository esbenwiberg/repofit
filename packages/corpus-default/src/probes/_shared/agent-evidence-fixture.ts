import {
  type AgentConfigEvidence,
  type AgentConfigTree,
  buildAgentConfigEvidence,
  type SizeStatsEvidence,
} from "@esbenwiberg/repofit/sdk";

export type AgentFixtureEvidence = {
  agent_config: AgentConfigEvidence;
  files: Record<string, string>;
  size_stats: SizeStatsEvidence;
};

/**
 * Fixture evidence for the `agent.*` probes from one in-memory tree: the
 * classified `agent_config`, the same files as `files`, and the tracked
 * paths (links included) as `size_stats`, so a fixture never touches disk
 * and the three views cannot disagree about what exists.
 */
export function agentFixture(tree: AgentConfigTree): AgentFixtureEvidence {
  const files = Object.entries(tree.files).map(([path, text]) => ({
    path,
    bytes: Buffer.byteLength(text),
    lines: countLines(text),
    depth: path.split("/").length - 1,
  }));
  const links = Object.entries(tree.links ?? {}).map(([path, target]) => ({
    path,
    bytes: Buffer.byteLength(target),
    lines: 1,
    depth: path.split("/").length - 1,
  }));
  const all = [...files, ...links].sort((a, b) => a.path.localeCompare(b.path));
  return {
    agent_config: buildAgentConfigEvidence(tree),
    files: tree.files,
    size_stats: {
      files: all,
      totalBytes: all.reduce((sum, f) => sum + f.bytes, 0),
      totalFiles: all.length,
      source: "git-ls-files",
    },
  };
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}
