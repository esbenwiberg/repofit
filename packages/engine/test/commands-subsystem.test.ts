import { describe, expect, test } from "vitest";
import { commandsSubsystem } from "../src/evidence/subsystems/commands.js";

describe("commands subsystem", () => {
  test("captures stdout, exitCode, and durationMs from a real spawn", async () => {
    const evidence = commandsSubsystem.gather({ cwd: process.cwd() });
    const run = await evidence.run({
      argv: ["node", "-e", "process.stdout.write('hi'); process.exit(0)"],
      timeoutMs: 5_000,
    });
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe("hi");
    expect(run.timedOut).toBe(false);
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
    expect(evidence.runCount()).toBe(1);
    expect(evidence.totalMs()).toBeGreaterThanOrEqual(0);
  });

  test("warmup runs the command twice but only counts the measured run", async () => {
    const evidence = commandsSubsystem.gather({ cwd: process.cwd() });
    await evidence.run({
      argv: ["node", "-e", "process.exit(0)"],
      warmup: 1,
      timeoutMs: 5_000,
    });
    expect(evidence.runCount()).toBe(1);
  });

  test("non-zero exit is reported, not thrown", async () => {
    const evidence = commandsSubsystem.gather({ cwd: process.cwd() });
    const run = await evidence.run({
      argv: ["node", "-e", "process.stderr.write('nope'); process.exit(7)"],
      timeoutMs: 5_000,
    });
    expect(run.exitCode).toBe(7);
    expect(run.stderr).toBe("nope");
  });

  test("timeout kills the child and reports timedOut", async () => {
    const evidence = commandsSubsystem.gather({ cwd: process.cwd() });
    const run = await evidence.run({
      argv: ["node", "-e", "setInterval(() => {}, 100)"],
      timeoutMs: 100,
    });
    expect(run.timedOut).toBe(true);
    expect(run.exitCode).toBeNull();
  });

  test("missing command resolves with stderr, not throw", async () => {
    const evidence = commandsSubsystem.gather({ cwd: process.cwd() });
    const run = await evidence.run({
      argv: ["this-command-does-not-exist-xyz"],
      timeoutMs: 5_000,
    });
    expect(run.exitCode).toBeNull();
    expect(run.stderr.length).toBeGreaterThan(0);
  });
});
