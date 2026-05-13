import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { defineFixer } from "@esbenwiberg/repofit/sdk";

const SYSTEM = `You are writing a CLAUDE.md (or AGENTS.md) for a software project. This file helps AI coding agents get oriented quickly.

Write concise markdown. No fluff, no marketing language. If you don't know something, write a TODO marker like '<!-- TODO: describe X -->' instead of inventing details. Do not wrap the output in code fences — the output IS the file content.

Required sections (in order):
1. A level-1 heading with the project name and a one-sentence description.
2. ## Build & Test — concrete commands derived from package.json scripts (or pyproject/Makefile/etc).
3. ## Architecture — one or two paragraphs describing the layout, based on the directory structure.
4. ## Conventions — only include this section if you can identify real conventions from the codebase (commit style, branching, lint config). If you can't, omit the section entirely.
5. ## Where to find things — a small markdown table mapping topics to paths.

Target 40–80 lines total.`;

export default defineFixer({
  probeId: "agent.guidance-present",
  mode: "llm",
  describe: "generate CLAUDE.md with Claude",
  async plan({ cwd, generate }) {
    const context = await collectContext(cwd);
    const prompt = buildPrompt(context);
    const content = await generate(prompt, { system: SYSTEM, maxTokens: 4096 });
    return {
      actions: [
        {
          kind: "write-file",
          path: "CLAUDE.md",
          content: ensureTrailingNewline(content),
          ifMissing: true,
        },
      ],
      notes: [
        "review the generated content before committing — it may include TODO markers or guesses",
      ],
    };
  },
});

type Context = {
  cwd: string;
  projectName: string;
  packageJson?: string;
  readme?: string;
  topLevelDirs: string[];
  topLevelFiles: string[];
};

async function collectContext(cwd: string): Promise<Context> {
  const projectName = path.basename(cwd) || "project";
  const packageJson = await readFileSafe(path.join(cwd, "package.json"));
  const readme = (await readFileSafe(path.join(cwd, "README.md"))) ?? undefined;
  const { dirs, files } = await listTopLevel(cwd);
  return {
    cwd,
    projectName,
    ...(packageJson ? { packageJson } : {}),
    ...(readme ? { readme: readme.slice(0, 2000) } : {}),
    topLevelDirs: dirs,
    topLevelFiles: files,
  };
}

async function readFileSafe(p: string): Promise<string | undefined> {
  try {
    return await readFile(p, "utf8");
  } catch {
    return undefined;
  }
}

async function listTopLevel(cwd: string): Promise<{ dirs: string[]; files: string[] }> {
  try {
    const entries = await readdir(cwd, { withFileTypes: true });
    const dirs: string[] = [];
    const files: string[] = [];
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "dist") continue;
      if (e.isDirectory()) dirs.push(e.name);
      else files.push(e.name);
    }
    dirs.sort();
    files.sort();
    return { dirs, files };
  } catch {
    return { dirs: [], files: [] };
  }
}

function buildPrompt(ctx: Context): string {
  const parts: string[] = [];
  parts.push(`Project name (inferred from directory): ${ctx.projectName}`);
  parts.push("");
  parts.push(`Top-level directories: ${ctx.topLevelDirs.join(", ") || "(none)"}`);
  parts.push(`Top-level files: ${ctx.topLevelFiles.join(", ") || "(none)"}`);
  if (ctx.packageJson) {
    parts.push("");
    parts.push("package.json:");
    parts.push("```json");
    parts.push(ctx.packageJson.slice(0, 3000));
    parts.push("```");
  }
  if (ctx.readme) {
    parts.push("");
    parts.push(
      "Existing README excerpt (use as background only — your output is a NEW CLAUDE.md):",
    );
    parts.push("```markdown");
    parts.push(ctx.readme);
    parts.push("```");
  }
  parts.push("");
  parts.push("Write the CLAUDE.md now.");
  return parts.join("\n");
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s : `${s}\n`;
}
