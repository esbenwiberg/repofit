import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CiWorkflow, CiWorkflowsEvidence, GatherContext } from "../../sdk/types.js";

const WORKFLOWS_DIR = ".github/workflows";

export const ciWorkflowsSubsystem = {
  async gather(ctx: GatherContext): Promise<CiWorkflowsEvidence> {
    const dir = join(ctx.cwd, WORKFLOWS_DIR);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
        return { present: false, workflows: [] };
      }
      throw err;
    }

    const workflows: CiWorkflow[] = [];
    for (const name of entries) {
      if (!/\.ya?ml$/i.test(name)) continue;
      const path = join(WORKFLOWS_DIR, name);
      let raw: string;
      try {
        raw = await readFile(join(ctx.cwd, path), "utf8");
      } catch {
        continue;
      }
      workflows.push({ path, raw });
    }
    return { present: workflows.length > 0, workflows };
  },
};
