import { describe, expect, test } from "vitest";
import type { Aggregated } from "../src/aggregator/index.js";
import type { LoadedCorpus } from "../src/loader/corpus.js";
import { renderHtml } from "../src/reporters/html.js";
import type { ReportInput } from "../src/reporters/json.js";
import type { ProbeResult } from "../src/runner/tiered.js";
import type { Probe } from "../src/sdk/types.js";
import type { Verdict } from "../src/verdict/index.js";

const fakeProbe = (id: string, overrides: Partial<Probe> = {}): Probe => ({
  id,
  version: "1.0.0",
  dimensions: [{ id: "context", weight: 1 }],
  tier: "static",
  evidence: ["files"] as const,
  rationale: "A README that touches canonical sections gives the agent a route to every question.",
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
  const verdict: Verdict = { mode: "ratchet", pass: true, reasons: [], dimensions: [] };
  return {
    cwd: "/repo",
    corpus,
    config: { gateMode: "ratchet" },
    aggregated,
    results,
    verdict,
    drift: { newProbes: [], removedProbes: [], corpusVersionMismatches: [] },
    baseline: null,
    ranAt: "2026-05-11T12:34:56Z",
    ...overrides,
  };
}

describe("html reporter", () => {
  test("emits a complete html document", () => {
    const html = renderHtml(inputFrom({}));
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("</html>");
    expect(html).toContain("<style>");
    expect(html).toContain("repofit");
  });

  test("renders headline fitness and gate badge", () => {
    const html = renderHtml(inputFrom({}));
    expect(html).toContain('<div class="score">80</div>');
    expect(html).toContain("ratchet · PASS");
  });

  test("shows gate FAIL with bad class when verdict fails", () => {
    const verdict: Verdict = {
      mode: "ratchet",
      pass: false,
      reasons: ["context: 60 < baseline 80"],
      dimensions: [],
    };
    const html = renderHtml(inputFrom({ verdict }));
    expect(html).toContain("gate bad");
    expect(html).toContain("ratchet · FAIL");
  });

  test("top opportunities sorted by fitness impact", () => {
    const results: ProbeResult[] = [
      {
        probe: fakeProbe("low.priority", {
          dimensions: [{ id: "context", weight: 1 }],
          score: { kind: "count", direction: "positive", bands: [{ score: 80 }] },
        }),
        reading: { kind: "count", value: 4 },
        score: 80,
      },
      {
        probe: fakeProbe("big.opportunity", {
          dimensions: [{ id: "context", weight: 1 }],
          score: { kind: "count", direction: "positive", bands: [{ score: 20 }] },
        }),
        reading: { kind: "count", value: 1 },
        score: 20,
      },
    ];
    const html = renderHtml(inputFrom({ results }));
    const opIdx = html.indexOf("Top opportunities");
    expect(opIdx).toBeGreaterThan(-1);
    const bigIdx = html.indexOf("big.opportunity");
    const lowIdx = html.indexOf("low.priority");
    expect(bigIdx).toBeGreaterThan(opIdx);
    expect(lowIdx).toBeGreaterThan(bigIdx);
  });

  test("scoring ladder marks current band with 'you are here'", () => {
    const probe = fakeProbe("docs.readme-substance", {
      score: {
        kind: "count",
        direction: "positive",
        bands: [
          { upTo: 1, score: 20 },
          { upTo: 3, score: 50 },
          { upTo: 5, score: 80 },
          { score: 100 },
        ],
      },
    });
    const results: ProbeResult[] = [{ probe, reading: { kind: "count", value: 3 }, score: 50 }];
    const aggregated: Aggregated = {
      fitness: 50,
      dimensions: [
        {
          id: "context",
          name: "Context",
          score: 50,
          gating: false,
          weight: 1,
          threshold: null,
          gatingThreshold: null,
          probeCount: 1,
        },
      ],
    };
    const html = renderHtml(inputFrom({ results, aggregated }));
    expect(html).toContain("you are here");
    // The "here" rung should be the ≤ 3 → 50 band.
    const hereRung = html.match(/<div class="rung here">[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(hereRung).toContain("≤ 3");
    expect(hereRung).toContain("50");
  });

  test("baseline section renders delta when baseline present", () => {
    const html = renderHtml(
      inputFrom({
        baseline: {
          fitness: 75,
          dimensions: { context: 75 },
          probes: { "docs.readme-present": 100 },
        },
      }),
    );
    expect(html).toContain('<section class="baseline">');
    expect(html).toContain("+5");
  });

  test("drift section surfaces new probes", () => {
    const html = renderHtml(
      inputFrom({
        baseline: {
          fitness: 80,
          dimensions: { context: 80 },
          probes: { "docs.readme-present": 100 },
        },
        drift: {
          newProbes: ["latency.build", "latency.lint"],
          removedProbes: [],
          corpusVersionMismatches: [],
        },
      }),
    );
    expect(html).toContain("latency.build");
    expect(html).toContain("latency.lint");
    expect(html).toContain("repofit check --accept");
  });

  test("escapes html-unsafe content in probe ids and rationale", () => {
    const probe = fakeProbe("evil<script>alert(1)</script>", {
      rationale: 'A "rationale" with <tags> & ampersands.',
    });
    const results: ProbeResult[] = [
      { probe, reading: { kind: "predicate", value: false }, score: 0 },
    ];
    const html = renderHtml(inputFrom({ results }));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;rationale&quot;");
    expect(html).toContain("&amp; ampersands");
  });

  test("all probes are collapsed by default", () => {
    const passing = fakeProbe("docs.readme-present");
    const failing = fakeProbe("ci.runs-tests");
    const results: ProbeResult[] = [
      { probe: passing, reading: { kind: "predicate", value: true }, score: 100 },
      { probe: failing, reading: { kind: "predicate", value: false }, score: 0 },
    ];
    const html = renderHtml(inputFrom({ results }));
    const failingMatch = html.match(/<details id="probe-ci-runs-tests"[^>]*>/)?.[0];
    const passingMatch = html.match(/<details id="probe-docs-readme-present"[^>]*>/)?.[0];
    expect(failingMatch).not.toContain(" open");
    expect(passingMatch).not.toContain(" open");
  });

  test("cost row shows executed tier seconds", () => {
    const html = renderHtml(inputFrom({ cost: { executedMs: 10_800 } }));
    expect(html).toContain("executed tier 10.8s");
  });

  test("disabled probes are excluded from top opportunities", () => {
    const disabledProbe = fakeProbe("secrets.precommit-scan-configured", {
      dimensions: [{ id: "safety", weight: 1 }],
      score: { kind: "predicate", direction: "positive" },
    });
    const passingProbe = fakeProbe("docs.readme-present", {
      dimensions: [{ id: "safety", weight: 1 }],
    });
    const results: ProbeResult[] = [
      { probe: disabledProbe, reading: { kind: "predicate", value: false }, score: 0 },
      { probe: passingProbe, reading: { kind: "predicate", value: true }, score: 100 },
    ];
    const aggregated: Aggregated = {
      fitness: 100,
      dimensions: [
        {
          id: "safety",
          name: "Safety",
          score: 100,
          gating: true,
          weight: 1,
          threshold: null,
          gatingThreshold: null,
          probeCount: 1,
        },
      ],
    };
    const html = renderHtml(
      inputFrom({
        results,
        aggregated,
        effectiveDimensions: [
          {
            id: "safety",
            name: "Safety",
            description: "",
            gating: true,
            overrides: [{ probeId: "secrets.precommit-scan-configured", weight: 0 }],
          },
        ],
      }),
    );
    // The disabled probe should not appear under "Top opportunities".
    const opStart = html.indexOf("Top opportunities");
    const opEnd = html.indexOf("</section>", opStart);
    const opSection = opStart === -1 ? "" : html.slice(opStart, opEnd);
    expect(opSection).not.toContain("secrets.precommit-scan-configured");
  });
});
