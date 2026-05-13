import { describe, expect, test } from "vitest";
import type { Aggregated } from "../src/aggregator/index.js";
import type { LoadedCorpus } from "../src/loader/corpus.js";
import type { ReportInput } from "../src/reporters/json.js";
import { renderMarkdown } from "../src/reporters/markdown.js";
import type { ProbeResult } from "../src/runner/tiered.js";
import type { Probe, Reading } from "../src/sdk/types.js";
import type { Verdict } from "../src/verdict/index.js";

const probe = (id: string, overrides: Partial<Probe> = {}): Probe => ({
  id,
  version: "1.0.0",
  dimensions: [{ id: "context", weight: 1 }],
  tier: "static",
  evidence: ["files"] as const,
  rationale: "rationale",
  remediation: "Run `npm run lint` to fix.",
  detect: async () => ({ kind: "predicate", value: true }),
  score: { kind: "predicate", direction: "positive" },
  fixtures: [],
  ...overrides,
});

const corpus: LoadedCorpus = {
  name: "@x/corpus",
  version: "1.0.0",
  probes: [],
  dimensions: [],
};

function aggregated(fitness: number | null, dims: Aggregated["dimensions"]): Aggregated {
  return { fitness, dimensions: dims };
}

function input(overrides: Partial<ReportInput>): ReportInput {
  const verdict: Verdict = { mode: "advisory", pass: true, reasons: [], dimensions: [] };
  return {
    cwd: "/repo",
    corpus,
    config: { gateMode: "advisory" },
    aggregated: aggregated(80, [
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
    ]),
    results: [],
    verdict,
    drift: { newProbes: [], removedProbes: [], corpusVersionMismatches: [] },
    baseline: null,
    ranAt: "2026-05-13T00:00:00Z",
    ...overrides,
  };
}

function result(p: Probe, reading: Reading, score: number | null): ProbeResult {
  return { probe: p, reading, score };
}

describe("markdown reporter", () => {
  test("headline shows verdict and score", () => {
    const md = renderMarkdown(input({}));
    expect(md).toMatch(/^\*\*repofit:\*\* \*\*advisory\*\* · fitness \*\*80\*\* \/ 100/);
  });

  test("headline includes baseline delta when present", () => {
    const md = renderMarkdown(
      input({
        baseline: { fitness: 75, dimensions: {}, probes: {} },
      }),
    );
    expect(md).toMatch(/was 75, \*\*\+5\*\*/);
  });

  test("dimension table renders one row per dimension", () => {
    const md = renderMarkdown(
      input({
        aggregated: aggregated(80, [
          {
            id: "context",
            name: "Context",
            score: 80,
            gating: false,
            weight: 1,
            threshold: null,
            gatingThreshold: null,
            probeCount: 9,
          },
          {
            id: "safety",
            name: "Safety",
            score: 100,
            gating: true,
            weight: 1,
            threshold: null,
            gatingThreshold: null,
            probeCount: 3,
          },
        ]),
      }),
    );
    expect(md).toMatch(/\| Dimension \| Score \| Δ \| Probes \|/);
    expect(md).toMatch(/\| Context \| 80 \| new \| 9 \|/);
    expect(md).toMatch(/\| Safety \(gating\) \| 100 \| new \| 3 \|/);
  });

  test("dimension delta shows — when baseline matches current", () => {
    const md = renderMarkdown(
      input({
        baseline: { fitness: 80, dimensions: { context: 80 }, probes: {} },
      }),
    );
    expect(md).toMatch(/\| Context \| 80 \| — \| 1 \|/);
  });

  test("dimension delta shows signed delta vs baseline", () => {
    const md = renderMarkdown(
      input({
        baseline: { fitness: 75, dimensions: { context: 75 }, probes: {} },
      }),
    );
    expect(md).toMatch(/\| Context \| 80 \| \*\*\+5\*\* \| 1 \|/);
  });

  test("attention section lists failing probes sorted by score", () => {
    const results: ProbeResult[] = [
      result(probe("a.high"), { kind: "predicate", value: true }, 100),
      result(probe("b.low"), { kind: "count", value: 5 }, 20),
      result(probe("c.mid"), { kind: "count", value: 2 }, 60),
    ];
    const md = renderMarkdown(input({ results }));
    expect(md).toMatch(/2 probes need attention/);
    const lowIdx = md.indexOf("`b.low`");
    const midIdx = md.indexOf("`c.mid`");
    expect(lowIdx).toBeGreaterThan(-1);
    expect(midIdx).toBeGreaterThan(lowIdx);
    expect(md).not.toMatch(/`a\.high`/);
  });

  test("attention section truncates long remediation", () => {
    const long = "X".repeat(300);
    const results: ProbeResult[] = [
      result(probe("a.long", { remediation: long }), { kind: "predicate", value: false }, 0),
    ];
    const md = renderMarkdown(input({ results }));
    expect(md).toMatch(/X{50,159}\.\.\./);
  });

  test("attention section omitted when all probes pass", () => {
    const results: ProbeResult[] = [result(probe("a.ok"), { kind: "predicate", value: true }, 100)];
    const md = renderMarkdown(input({ results }));
    expect(md).not.toMatch(/needs? attention/);
  });

  test("footer reports drift and cost", () => {
    const md = renderMarkdown(
      input({
        drift: {
          newProbes: ["x.one", "x.two"],
          removedProbes: [],
          corpusVersionMismatches: [],
        },
        cost: { executedMs: 14600 },
        commit: "abcdef0123456",
      }),
    );
    expect(md).toMatch(/2 new probes since baseline/);
    expect(md).toMatch(/executed tier 14\.6s/);
    expect(md).toMatch(/commit abcdef0/);
  });

  test("trailing newline only — no extra blank lines", () => {
    const md = renderMarkdown(input({}));
    expect(md.endsWith("\n")).toBe(true);
    expect(md.endsWith("\n\n")).toBe(false);
  });
});
