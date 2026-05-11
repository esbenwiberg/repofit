import { describe, expect, test } from "vitest";
import type { Aggregated } from "../src/aggregator/index.js";
import type { LoadedCorpus } from "../src/loader/corpus.js";
import { buildReport, type ReportInput } from "../src/reporters/json.js";
import type { ProbeResult } from "../src/runner/tiered.js";
import type { Probe } from "../src/sdk/types.js";
import type { Verdict } from "../src/verdict/index.js";

const fakeProbe = (id: string, tier: string = "static"): Probe => ({
  id,
  version: "1.0.0",
  dimensions: [{ id: "context", weight: 1 }],
  tier: tier as Probe["tier"],
  evidence: ["files"] as const,
  rationale: "",
  detect: async () => ({ kind: "predicate", value: true }),
  score: { kind: "predicate", direction: "positive" },
  fixtures: [],
});

const corpus: LoadedCorpus = {
  name: "@x/corpus",
  version: "1.0.0",
  probes: [],
  dimensions: [],
};

function inputFrom(overrides: Partial<ReportInput>): ReportInput {
  const aggregated: Aggregated = {
    fitness: 80,
    dimensions: [
      {
        id: "context",
        name: "Context",
        score: 80,
        gating: false,
        weight: 1,
        threshold: null,
        gatingThreshold: null,
        probeCount: 1,
      },
    ],
  };
  const results: ProbeResult[] = [
    {
      probe: fakeProbe("docs.readme-present"),
      reading: { kind: "predicate", value: true },
      score: 100,
    },
  ];
  const verdict: Verdict = { mode: "advisory", pass: true, reasons: [], dimensions: [] };
  return {
    cwd: "/repo",
    corpus,
    config: { gateMode: "advisory" },
    aggregated,
    results,
    verdict,
    drift: { newProbes: [], removedProbes: [], corpusVersionMismatches: [] },
    baseline: null,
    ranAt: "2026-05-11T00:00:00Z",
    ...overrides,
  };
}

describe("json reporter", () => {
  test("emits versioned schema with stable shape", () => {
    const report = buildReport(inputFrom({}));
    expect(report.version).toBe(1);
    expect(report.tool.name).toBe("repofit");
    expect(report.corpus).toEqual([{ package: "@x/corpus", version: "1.0.0" }]);
    expect(report.fitness.score).toBe(80);
    expect(report.fitness.baseline).toBeNull();
    expect(report.fitness.delta).toBeNull();
  });

  test("verdict translates advisory/pass/fail", () => {
    expect(buildReport(inputFrom({})).verdict).toBe("advisory");

    const passing: Verdict = { mode: "ratchet", pass: true, reasons: [], dimensions: [] };
    expect(buildReport(inputFrom({ verdict: passing })).verdict).toBe("pass");

    const failing: Verdict = { mode: "ratchet", pass: false, reasons: ["x"], dimensions: [] };
    expect(buildReport(inputFrom({ verdict: failing })).verdict).toBe("fail");
  });

  test("delta computed from baseline when present", () => {
    const report = buildReport(
      inputFrom({
        baseline: {
          fitness: 75,
          dimensions: { context: 75 },
          probes: { "docs.readme-present": 100 },
        },
      }),
    );
    expect(report.fitness.delta).toBe(5);
    expect(report.dimensions.context?.delta).toBe(5);
    expect(report.probes[0]?.delta).toBe(0);
  });

  test("summary tallies pass/fail/na/error", () => {
    const results: ProbeResult[] = [
      { probe: fakeProbe("a"), reading: { kind: "predicate", value: true }, score: 100 },
      { probe: fakeProbe("b"), reading: { kind: "predicate", value: false }, score: 0 },
      { probe: fakeProbe("c"), reading: { kind: "na", reason: "x" }, score: null },
      { probe: fakeProbe("d"), reading: { kind: "error", error: "x" }, score: null },
    ];
    const report = buildReport(inputFrom({ results }));
    expect(report.summary).toEqual({ ran: 4, pass: 1, fail: 1, na: 1, error: 1 });
  });

  test("probes sorted alphabetically", () => {
    const results: ProbeResult[] = [
      { probe: fakeProbe("zebra"), reading: { kind: "predicate", value: true }, score: 100 },
      { probe: fakeProbe("apple"), reading: { kind: "predicate", value: true }, score: 100 },
    ];
    const report = buildReport(inputFrom({ results }));
    expect(report.probes.map((p) => p.id)).toEqual(["apple", "zebra"]);
  });

  test("cost block only appears when executed tier ran", () => {
    const withoutCost = buildReport(inputFrom({}));
    expect(withoutCost.cost).toBeUndefined();

    const withCost = buildReport(inputFrom({ cost: { executedMs: 12_345 } }));
    expect(withCost.cost).toEqual({ executedMs: 12_345 });
  });
});
