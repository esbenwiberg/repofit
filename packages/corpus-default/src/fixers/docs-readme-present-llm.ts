import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { defineFixer } from "@esbenwiberg/repofit/sdk";

const SYSTEM = `You are writing a README.md for a software project. The audience is humans (not AI agents).

Write concise markdown. No filler, no marketing language. If you don't know something, write a TODO marker like '<!-- TODO: describe X -->' rather than fabricate details. Do not wrap the output in code fences — the output IS the file content.

Required sections (in order):
1. A level-1 heading with the project name, followed by a one-sentence description.
2. ## Install — exact command (npm/pip/cargo/etc.) based on the package manifest.
3. ## Usage — a small example (a few lines of code or a CLI invocation) that demonstrates the simplest use case.
4. ## Development — install/build/test commands derived from package scripts.
5. ## License — state the license if you can identify one (LICENSE file, package.json license field). Otherwise put 'TBD'.

Target 40–100 lines.`;

export default defineFixer({
  probeId: "docs.readme-present",
  mode: "llm",
  describe: "generate README.md with Claude",
  async plan({ cwd, generate }) {
    const context = await collectContext(cwd);
    const prompt = buildPrompt(context);
    const content = await generate(prompt, { system: SYSTEM, maxTokens: 4096 });
    return {
      actions: [
        {
          kind: "write-file",
          path: "README.md",
          content: ensureTrailingNewline(content),
          ifMissing: true,
        },
      ],
      notes: [
        "review the generated content before committing — sections may have TODO markers or guesses",
      ],
    };
  },
});

type Context = {
  cwd: string;
  projectName: string;
  packageJson?: string;
  license?: string;
  topLevelDirs: string[];
  topLevelFiles: string[];
};

async function collectContext(cwd: string): Promise<Context> {
  const projectName = path.basename(cwd) || "project";
  const packageJson = await readFileSafe(path.join(cwd, "package.json"));
  const license = await readFileSafe(path.join(cwd, "LICENSE"));
  const { dirs, files } = await listTopLevel(cwd);
  return {
    cwd,
    projectName,
    ...(packageJson ? { packageJson } : {}),
    ...(license ? { license: license.slice(0, 500) } : {}),
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
  if (ctx.license) {
    parts.push("");
    parts.push("LICENSE excerpt:");
    parts.push("```");
    parts.push(ctx.license);
    parts.push("```");
  }
  parts.push("");
  parts.push("Write the README.md now.");
  return parts.join("\n");
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s : `${s}\n`;
}
