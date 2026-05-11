import { spawn } from "node:child_process";
import type { CommandRun, CommandSpec, CommandsEvidence, GatherContext } from "../../sdk/types.js";

const DEFAULT_TIMEOUT_MS = 60_000;

export const commandsSubsystem = {
  gather(ctx: GatherContext): CommandsEvidence {
    let totalMs = 0;
    let runs = 0;

    return {
      async run(spec: CommandSpec): Promise<CommandRun> {
        const cwd = spec.cwd ?? ctx.cwd;
        const timeoutMs = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const warmup = spec.warmup ?? 0;

        for (let i = 0; i < warmup; i += 1) {
          await execOne(spec.argv, cwd, timeoutMs, spec.env);
        }

        const measured = await execOne(spec.argv, cwd, timeoutMs, spec.env);
        totalMs += measured.durationMs;
        runs += 1;
        return measured;
      },
      totalMs: () => totalMs,
      runCount: () => runs,
    };
  },
};

function execOne(
  argv: string[],
  cwd: string,
  timeoutMs: number,
  env: Record<string, string> | undefined,
): Promise<CommandRun> {
  const [command, ...args] = argv;
  if (command === undefined) {
    return Promise.resolve({
      exitCode: null,
      durationMs: 0,
      stdout: "",
      stderr: "argv is empty",
      timedOut: false,
    });
  }

  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      const durationMs = Number((process.hrtime.bigint() - start) / 1_000_000n);
      resolve({
        exitCode: null,
        durationMs,
        stdout,
        stderr: stderr || err.message,
        timedOut,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const durationMs = Number((process.hrtime.bigint() - start) / 1_000_000n);
      resolve({
        exitCode: code,
        durationMs,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}
