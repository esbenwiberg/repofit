import {
  type Content,
  classifyAgentConfig,
  contentOf,
  type Entry,
  GUIDANCE_CANDIDATES,
} from "../evidence/subsystems/agent-config.js";
import type { AgentConfigEvidence, GuidanceFile } from "../sdk/types.js";
import { countLines } from "../util/count-lines.js";

/** An in-memory tree: regular files by content, symlinks by target as written. */
export type AgentConfigTree = {
  files: Record<string, string>;
  links?: Record<string, string>;
};

/**
 * Build `agent_config` evidence from an in-memory tree with the same
 * classification the gatherer applies to a checkout, so probe fixtures
 * exercise real link, include and frontmatter handling without touching disk.
 */
export function buildAgentConfigEvidence(tree: AgentConfigTree): AgentConfigEvidence {
  const links = new Map<string, string | null>(Object.entries(tree.links ?? {}));
  const entries: Entry[] = [
    ...Object.keys(tree.files).map((path) => ({ path, isLink: false })),
    ...[...links.keys()].map((path) => ({ path, isLink: true })),
  ].sort((a, b) => a.path.localeCompare(b.path));
  const contents = new Map<string, Content>();
  for (const [path, text] of Object.entries(tree.files)) {
    contents.set(path, contentOf(Buffer.from(text, "utf8")));
  }
  const evidence = classifyAgentConfig({
    entries,
    links,
    contents,
    guidance: [],
    source: "git-ls-files",
  });
  const guidance = rootGuidance(tree, evidence);
  const present = new Set(guidance.map((g) => g.path));
  return { ...evidence, guidance, has: (p) => present.has(p) };
}

/** Root candidates read through links, matching `readRootGuidance` on a checkout. */
function rootGuidance(tree: AgentConfigTree, evidence: AgentConfigEvidence): GuidanceFile[] {
  const out: GuidanceFile[] = [];
  for (const name of GUIDANCE_CANDIDATES) {
    const direct = tree.files[name];
    if (direct !== undefined) {
      out.push({ path: name, bytes: Buffer.byteLength(direct), lines: countLines(direct) });
      continue;
    }
    const linked = evidence.instructionFiles.find((f) => f.path === name && f.link?.targetExists);
    if (linked) out.push({ path: name, bytes: linked.bytes, lines: linked.lines });
  }
  return out;
}
