import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AgentConfigEvidence, GatherContext, GuidanceFile } from "../../sdk/types.js";
import { countLines } from "../../util/count-lines.js";

export const GUIDANCE_CANDIDATES = [
  "CLAUDE.md",
  "AGENTS.md",
  ".cursorrules",
  ".aider.conf.yml",
] as const;

export const agentConfigSubsystem = {
  async gather(ctx: GatherContext): Promise<AgentConfigEvidence> {
    const root = ctx.cwd;

    const found = await Promise.all(
      GUIDANCE_CANDIDATES.map(async (name): Promise<GuidanceFile | null> => {
        const full = join(root, name);
        try {
          const [s, content] = await Promise.all([stat(full), readFile(full, "utf8")]);
          return { path: name, bytes: s.size, lines: countLines(content) };
        } catch {
          return null;
        }
      }),
    );

    const guidance = found.filter((g): g is GuidanceFile => g !== null);
    const present = new Set(guidance.map((g) => g.path));

    return {
      guidance,
      has(path: string): boolean {
        return present.has(path);
      },
    };
  },
};
