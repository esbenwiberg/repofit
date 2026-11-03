import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Aggregated } from "../src/aggregator/index.js";
import type { LoadedCorpus } from "../src/loader/corpus.js";
import { renderCi } from "../src/reporters/ci.js";
import type { ReportInput } from "../src/reporters/json.js";
import type { ProbeResult } from "../src/runner/tiered.js";
import type { Probe } from "../src/sdk/types.js";
import type { Verdict } from "../src/verdict/index.js";

const corpus: LoadedCorpus = { name: "@x/corpus", version: "1.0.0", probes: [], dimensions: [] };

function probeWithInventory(id: string): Probe {
  return {
    id,
    version: "1.0.0",
    dimensions: [{ id: "safety", weight: 1 }],
    tier: "static",
    evidence: ["files"] as const,
    rationale: "",
    detect: async () => ({ kind: "inventory", items: [] }),
    score: {
      kind: "inventory",
      severityWeights: { info: 1, warn: 3, error: 10 },
      bands: [{ score: 0 }],
    },
    fixtures: [],
  };
}

function baseInput(): ReportInput {
  const aggregated: Aggregated = { fitness: 80, dimensions: [] };
  const verdict: Verdict = { mode: "ratchet", pass: true, reasons: [], dimensions: [] };
  return {
    cwd: "/repo",
    corpus,
    config: { gateMode: "ratchet" },
    aggregated,
    results: [],
    verdict,
    drift: { newProbes: [], removedProbes: [], corpusVersionMismatches: [] },
    baseline: null,
    ranAt: "2026-05-11T00:00:00Z",
  };
}

describe("ci reporter", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "repofit-ci-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("verdict line includes mode and PASS/FAIL", async () => {
    const out = await renderCi(baseInput());
    expect(out.stdout).toContain("ratchet");
    expect(out.stdout).toContain("PASS");
    expect(out.annotations).toEqual([]);
  });

  test("a failing ratchet names the reasons and every probe that dropped", async () => {
    const input = baseInput();
    input.aggregated = { fitness: 70, dimensions: [] };
    input.verdict = {
      mode: "ratchet",
      pass: false,
      reasons: ["consistency: 85 < baseline 95"],
      dimensions: [{ id: "consistency", pass: false, reason: "consistency: 85 < baseline 95" }],
    };
    input.results = [
      {
        probe: probeWithInventory("a.dropped"),
        reading: { kind: "inventory", items: [] },
        score: 20,
      },
      {
        probe: probeWithInventory("b.steady"),
        reading: { kind: "inventory", items: [] },
        score: 100,
      },
    ];
    input.baseline = { fitness: 80, dimensions: {}, probes: { "a.dropped": 100, "b.steady": 100 } };
    const out = await renderCi(input);
    const lines = out.stdout.split("\n");
    expect(lines[0]).toContain("FAIL");
    expect(lines.slice(1)).toEqual([
      "  consistency: 85 < baseline 95",
      "  a.dropped: 20 (baseline 100, -80)",
    ]);
  });

  test("a passing gate prints the headline alone", async () => {
    const out = await renderCi(baseInput());
    expect(out.stdout.split("\n")).toHaveLength(1);
  });

  test("emits GitHub annotations only when githubActions=true", async () => {
    const results: ProbeResult[] = [
      {
        probe: probeWithInventory("safety.dangerous-script-flags"),
        reading: {
          kind: "inventory",
          items: [
            {
              location: { path: "package.json", range: { startLine: 12 } },
              severity: "warn",
              message: "uses rm -rf",
            },
          ],
        },
        score: 70,
      },
    ];
    const off = await renderCi({ ...baseInput(), results });
    expect(off.annotations).toEqual([]);

    const on = await renderCi({ ...baseInput(), results, githubActions: true });
    expect(on.annotations).toHaveLength(1);
    expect(on.annotations[0]).toMatch(/^::warning file=package.json,line=12::/);
    expect(on.annotations[0]).toContain("safety.dangerous-script-flags: uses rm -rf");
  });

  test("writes artifact when artifactPath is set", async () => {
    const artifactPath = join(tmp, "report.json");
    const out = await renderCi({ ...baseInput(), artifactPath });
    expect(out.artifactWritten).toBe(artifactPath);
    const parsed = JSON.parse(readFileSync(artifactPath, "utf8"));
    expect(parsed.version).toBe(1);
    expect(parsed.tool.name).toBe("repofit");
  });
});
