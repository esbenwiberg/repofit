import { describe, expect, test } from "vitest";
import type { Aggregated } from "../src/aggregator/index.js";
import { type RenderInput, renderHuman } from "../src/reporters/human-minimal.js";
import type { ProbeResult } from "../src/runner/tiered.js";
import type { Probe } from "../src/sdk/types.js";
import type { Verdict } from "../src/verdict/index.js";

const fakeProbe = (id: string): Probe => ({
  id,
  version: "1.0.0",
  dimensions: [{ id: "feedback", weight: 1 }],
  tier: "executed",
  evidence: ["toolchain", "commands"] as const,
  rationale: "",
  detect: async () => ({ kind: "predicate", value: true }),
  score: { kind: "predicate", direction: "positive" },
  fixtures: [],
});

function baseInput(overrides: Partial<RenderInput> = {}): RenderInput {
  const aggregated: Aggregated = { fitness: 80, dimensions: [] };
  const verdict: Verdict = { mode: "advisory", pass: true, reasons: [], dimensions: [] };
  return {
    aggregated,
    results: [],
    verdict,
    drift: { newProbes: [], removedProbes: [], corpusVersionMismatches: [] },
    ...overrides,
  };
}

describe("renderHuman — no-stack banner", () => {
  test("emits banner when toolchain primary is null AND probes were skipped for stack reasons", () => {
    const results: ProbeResult[] = [
      {
        probe: fakeProbe("lint.clean"),
        reading: {
          kind: "na",
          reason:
            "no lint command — declare commands.lint in repofit.config.json, or configure a lint tool for your stack",
        },
        score: null,
      },
      {
        probe: fakeProbe("build.clean"),
        reading: { kind: "na", reason: "no build command for the primary stack" },
        score: null,
      },
    ];
    const out = renderHuman(baseInput({ results, toolchain: { stacks: [], primary: null } }));
    expect(out).toContain("no supported stack detected");
    expect(out).toContain("2 probes skipped");
    expect(out).toContain("lint.clean");
    expect(out).toContain("build.clean");
    expect(out).toContain("repofit.config.json");
  });

  test("omits banner when a primary stack IS detected", () => {
    const results: ProbeResult[] = [
      {
        probe: fakeProbe("lint.clean"),
        reading: { kind: "predicate", value: true },
        score: 100,
      },
    ];
    const out = renderHuman(
      baseInput({ results, toolchain: { stacks: ["node"], primary: "node" } }),
    );
    expect(out).not.toContain("no supported stack detected");
  });

  test("omits banner when primary is null but no probe mentioned 'command' or 'stack'", () => {
    const results: ProbeResult[] = [
      {
        probe: fakeProbe("lint.clean"),
        reading: { kind: "na", reason: "no README.md" },
        score: null,
      },
    ];
    const out = renderHuman(baseInput({ results, toolchain: { stacks: [], primary: null } }));
    expect(out).not.toContain("no supported stack detected");
  });

  test("omits banner when toolchain is undefined (backwards compat)", () => {
    const results: ProbeResult[] = [
      {
        probe: fakeProbe("lint.clean"),
        reading: { kind: "na", reason: "no lint command" },
        score: null,
      },
    ];
    const out = renderHuman(baseInput({ results }));
    expect(out).not.toContain("no supported stack detected");
  });
});

test("reports unsuccessful command attempts separately from a passing gate", () => {
  const out = renderHuman(
    baseInput({
      executions: [
        {
          sequence: 1,
          argv: ["node", "check.js"],
          cwd: "/repo",
          role: "warmup",
          firstObserved: true,
          exitCode: 7,
          durationMs: 12,
          timedOut: false,
          stdout: "",
          stderr: "failure",
          diagnosticsTruncated: false,
        },
      ],
    }),
  );
  expect(out).toContain("1 command attempt(s), 1 unsuccessful");
  expect(out).toContain("warmup / first observed: exit 7");
  expect(out).toContain("not a clean cold run");
  expect(out).toContain("advisory  ·  PASS");
});
