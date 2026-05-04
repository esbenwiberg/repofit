import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { REPO_ROOT } from "./paths.js";

const CLI_ENTRY = resolve(REPO_ROOT, "dist/index.js");

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
  cwd: string;
}

export interface CliOptions {
  cwd: string;
  env?: Record<string, string>;
  stdin?: string;
}

export async function runCli(
  args: readonly string[],
  options: CliOptions,
): Promise<CliResult> {
  return new Promise((resolveResult, rejectPromise) => {
    const child = spawn(process.execPath, [CLI_ENTRY, ...args], {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));

    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolveResult({
        code: code ?? 1,
        stdout,
        stderr,
        cwd: options.cwd,
      });
    });

    child.stdin.end(options.stdin ?? "");
  });
}
