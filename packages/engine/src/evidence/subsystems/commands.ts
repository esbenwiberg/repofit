import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type {
  CommandExecution,
  CommandRun,
  CommandSpec,
  CommandsEvidence,
  GatherContext,
} from "../../sdk/types.js";
import { startTimer } from "../../util/timing.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 1_048_576;
const MAX_DIAGNOSTIC_BYTES = 4_096;

export const commandsSubsystem = {
  gather(ctx: GatherContext): CommandsEvidence {
    const history: CommandExecution[] = [];
    const observed = new Set<string>();
    let sequence = 0;
    return {
      records: () =>
        history
          .slice()
          .sort((a, b) => a.sequence - b.sequence)
          .map((record) => ({ ...record, argv: [...record.argv] })),
      async run(spec: CommandSpec): Promise<CommandRun> {
        const cwd = resolve(spec.cwd ?? ctx.cwd);
        const argv = [...spec.argv];
        const timeoutMs = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const warmup = spec.warmup ?? 0;
        const key = JSON.stringify([
          argv,
          cwd,
          Object.entries(spec.env ?? {}).sort(([a], [b]) => a.localeCompare(b)),
        ]);
        const attempt = async (role: CommandExecution["role"]): Promise<CommandRun> => {
          const firstObserved = !observed.has(key);
          observed.add(key);
          const order = ++sequence;
          const run = await execOne(argv, cwd, timeoutMs, spec.env);
          history.push({
            ...run,
            sequence: order,
            argv: [...argv],
            cwd,
            role,
            firstObserved,
            stdout: diagnostic(run.stdout),
            stderr: diagnostic(run.stderr),
            diagnosticsTruncated:
              Buffer.byteLength(run.stdout) > MAX_DIAGNOSTIC_BYTES ||
              Buffer.byteLength(run.stderr) > MAX_DIAGNOSTIC_BYTES,
          });
          return run;
        };

        for (let i = 0; i < warmup; i += 1) {
          await attempt("warmup");
        }

        return attempt("measured");
      },
    };
  },
};

function diagnostic(text: string): string {
  const bytes = Buffer.from(text);
  let end = Math.min(bytes.length, MAX_DIAGNOSTIC_BYTES);
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}

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
    const elapsed = startTimer();
    const child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) {
        stdout += chunk.toString(
          "utf8",
          0,
          Math.min(chunk.length, MAX_OUTPUT_BYTES - stdout.length),
        );
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) {
        stderr += chunk.toString(
          "utf8",
          0,
          Math.min(chunk.length, MAX_OUTPUT_BYTES - stderr.length),
        );
      }
    });

    const finish = (run: CommandRun) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(run);
    };

    child.on("error", (err) => {
      finish({
        exitCode: null,
        durationMs: elapsed(),
        stdout,
        stderr: stderr || err.message,
        timedOut,
      });
    });

    child.on("close", (code) => {
      finish({
        exitCode: code,
        durationMs: elapsed(),
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}
