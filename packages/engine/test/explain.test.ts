import { describe, expect, test } from "vitest";
import { explain } from "../src/cli/explain.js";

describe("explain", () => {
  test("renders an existing probe with rationale + scoring", async () => {
    const { stdout, exitCode } = await explain({ id: "agent.guidance-present" });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Probe       agent.guidance-present");
    expect(stdout).toContain("Rationale");
    expect(stdout).toContain("Scoring");
    expect(stdout).toContain("predicate, direction positive");
  });

  test("renders a dimension with contributing probes", async () => {
    const { stdout, exitCode } = await explain({ id: "context" });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Dimension   Context");
    expect(stdout).toContain("Contributing probes");
    expect(stdout).toContain("agent.guidance-present");
  });

  test("returns exit code 2 on unknown id, listing known ids", async () => {
    const { stdout, exitCode } = await explain({ id: "no.such.thing" });
    expect(exitCode).toBe(2);
    expect(stdout).toContain("no probe or dimension 'no.such.thing'");
    expect(stdout).toContain("Known ids:");
  });

  test("--run shows a 'Run on this repo' section with reading + score derivation", async () => {
    // agent.guidance-present is a static predicate probe with no side effects;
    // safe to actually run against the repofit repo itself.
    const { stdout, exitCode } = await explain({
      id: "agent.guidance-present",
      run: true,
      cwd: process.cwd(),
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Run on this repo");
    expect(stdout).toMatch(/reading\s+predicate · value=(true|false)/);
    expect(stdout).toMatch(/score\s+(0|100)/);
    expect(stdout).toContain("direction=positive");
    // The hint to re-run with --run should disappear once we already ran.
    expect(stdout).not.toContain("To run against this repo");
  });

  test("shows 'How to fix' section when probe defines remediation", async () => {
    const { stdout, exitCode } = await explain({ id: "agent.guidance-present" });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("How to fix");
    expect(stdout).toContain("CLAUDE.md");
  });

  test("without --run, the trace section is omitted and the hint is shown", async () => {
    const { stdout, exitCode } = await explain({ id: "agent.guidance-present" });
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("Run on this repo");
    expect(stdout).toContain("To run against this repo");
    expect(stdout).toContain("repofit explain agent.guidance-present --run");
  });
});
