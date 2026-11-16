import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  });

  test("warmup runs the command twice; only the measured run is returned", async () => {
    const evidence = commandsSubsystem.gather({ cwd: process.cwd() });
    const run = await evidence.run({
      argv: ["node", "-e", "process.stdout.write('measured'); process.exit(0)"],
      warmup: 1,
      timeoutMs: 5_000,
    });
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe("measured");
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

describe("observed command evidence", () => {
  test("retains a failed warm-up and measured pass without adding executions", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "repofit-attempts-"));
    try {
      const evidence = commandsSubsystem.gather({ cwd });
      const argv = [
        process.execPath,
        "-e",
        `
        const fs = require('node:fs');
        const n = fs.existsSync('attempts') ? Number(fs.readFileSync('attempts', 'utf8')) + 1 : 1;
        fs.writeFileSync('attempts', String(n));
        process.stdout.write('attempt ' + n);
        process.exit(n === 1 ? 7 : 0);
      `,
      ];
      const result = await evidence.run({ argv, warmup: 1 });
      const records = evidence.records?.() ?? [];
      expect(await readFile(join(cwd, "attempts"), "utf8")).toBe("2");
      expect(result.exitCode).toBe(0);
      expect(
        records.map((r) => [r.sequence, r.role, r.firstObserved, r.exitCode, r.stdout]),
      ).toEqual([
        [1, "warmup", true, 7, "attempt 1"],
        [2, "measured", false, 0, "attempt 2"],
      ]);
      expect(records.every((r) => r.cwd === cwd && r.durationMs >= 0)).toBe(true);
      argv[0] = "changed-after-execution";
      const first = records[0];
      if (!first) throw new Error("missing recorded attempt");
      first.argv[0] = "changed-snapshot";
      expect(evidence.records?.()[0]?.argv[0]).toBe(process.execPath);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("bounds retained diagnostics while preserving the existing probe result", async () => {
    const evidence = commandsSubsystem.gather({ cwd: process.cwd() });
    const result = await evidence.run({
      argv: [process.execPath, "-e", "process.stdout.write('x'.repeat(8000))"],
    });
    const record = evidence.records?.()[0];
    expect(result.stdout).toHaveLength(8000);
    expect(record?.stdout).toHaveLength(4096);
    expect(record?.diagnosticsTruncated).toBe(true);
    await evidence.run({
      argv: [process.execPath, "-e", "process.stdout.write('x' + '🤖'.repeat(2000))"],
    });
    const unicode = evidence.records?.()[1]?.stdout ?? "";
    expect(Buffer.byteLength(unicode)).toBeLessThanOrEqual(4096);
    expect(unicode).not.toContain("\uFFFD");
  });

  test("records missing executables, empty argv and timeouts as unsuccessful attempts", async () => {
    const evidence = commandsSubsystem.gather({ cwd: process.cwd() });
    await evidence.run({ argv: ["repofit-intentionally-missing-command"] });
    await evidence.run({ argv: [] });
    await evidence.run({
      argv: [process.execPath, "-e", "setInterval(() => {}, 100)"],
      timeoutMs: 100,
    });
    const records = evidence.records?.() ?? [];
    expect(records).toHaveLength(3);
    expect(records.every((r) => r.exitCode === null)).toBe(true);
    expect(records[0]?.stderr).toContain("ENOENT");
    expect(records[1]?.stderr).toContain("argv is empty");
    expect(records[2]?.timedOut).toBe(true);
  });

  test("collecting records does not execute a command", () => {
    const evidence = commandsSubsystem.gather({ cwd: process.cwd() });
    expect(evidence.records?.()).toEqual([]);
  });
});
