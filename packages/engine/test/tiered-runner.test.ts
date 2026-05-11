import { describe, expect, test } from "vitest";
import { runProbes } from "../src/runner/tiered.js";
import type { EvidenceMap, Probe, Tier } from "../src/sdk/types.js";

const ALL_TIERS = new Set<Tier>(["static", "derived", "historical", "executed", "reasoned"]);

const EMPTY_EVIDENCE: EvidenceMap = {
  files: { has: () => false, readText: async () => undefined },
  agent_config: { guidance: [], has: () => false },
  node_package: {
    present: false,
    dependencies: {},
    devDependencies: {},
    scripts: {},
    raw: null,
  },
  gitignore: { present: false, patterns: [], ignores: () => false },
  size_stats: { files: [], totalBytes: 0, totalFiles: 0, source: "none" },
  ci_workflows: { present: false, workflows: [] },
  commit_history: { available: false, commits: [] },
  commands: {
    run: async () => ({ exitCode: 0, durationMs: 0, stdout: "", stderr: "", timedOut: false }),
    totalMs: () => 0,
    runCount: () => 0,
  },
  github_api: {
    branchProtection: async () => ({ kind: "unavailable", reason: "test" }),
  },
};

function mkProbe(id: string, tier: Tier, detect: Probe["detect"]): Probe {
  return {
    id,
    version: "0.0.0",
    dimensions: [{ id: "context", weight: 1 }],
    tier,
    evidence: [],
    rationale: "",
    detect,
    score: { kind: "predicate", direction: "positive" },
    fixtures: [],
  };
}

describe("tiered runner", () => {
  test("groups by tier and runs static before derived before executed", async () => {
    const order: string[] = [];
    const probes: Probe[] = [
      mkProbe("executed.a", "executed", async () => {
        order.push("executed.a");
        return { kind: "predicate", value: true };
      }),
      mkProbe("static.a", "static", async () => {
        order.push("static.a");
        return { kind: "predicate", value: true };
      }),
      mkProbe("derived.a", "derived", async () => {
        order.push("derived.a");
        return { kind: "predicate", value: true };
      }),
    ];

    await runProbes(probes, EMPTY_EVIDENCE, { includeTiers: ALL_TIERS });

    expect(order).toEqual(["static.a", "derived.a", "executed.a"]);
  });

  test("default include set excludes executed and reasoned tiers", async () => {
    const probes: Probe[] = [
      mkProbe("static.a", "static", async () => ({ kind: "predicate", value: true })),
      mkProbe("executed.a", "executed", async () => ({ kind: "predicate", value: true })),
      mkProbe("reasoned.a", "reasoned", async () => ({ kind: "predicate", value: true })),
    ];
    const results = await runProbes(probes, EMPTY_EVIDENCE);
    expect(results.map((r) => r.probe.id)).toEqual(["static.a"]);
  });

  test("intra-tier probes run in parallel", async () => {
    let bStarted = (): void => undefined;
    let aStarted = (): void => undefined;
    const aHasStarted = new Promise<void>((resolve) => {
      aStarted = resolve;
    });
    const bHasStarted = new Promise<void>((resolve) => {
      bStarted = resolve;
    });

    const probes: Probe[] = [
      mkProbe("static.a", "static", async () => {
        aStarted();
        await bHasStarted;
        return { kind: "predicate", value: true };
      }),
      mkProbe("static.b", "static", async () => {
        bStarted();
        await aHasStarted;
        return { kind: "predicate", value: true };
      }),
    ];

    const results = await runProbes(probes, EMPTY_EVIDENCE);
    expect(results).toHaveLength(2);
  }, 1000);

  test("a probe throwing in detect becomes an error reading without halting the tier", async () => {
    const probes: Probe[] = [
      mkProbe("static.bad", "static", async () => {
        throw new Error("boom");
      }),
      mkProbe("static.good", "static", async () => ({ kind: "predicate", value: true })),
    ];

    const results = await runProbes(probes, EMPTY_EVIDENCE);
    const byId = new Map(results.map((r) => [r.probe.id, r]));
    expect(byId.get("static.bad")?.reading).toEqual({ kind: "error", error: "boom" });
    expect(byId.get("static.bad")?.score).toBeNull();
    expect(byId.get("static.good")?.reading).toEqual({ kind: "predicate", value: true });
    expect(byId.get("static.good")?.score).toBe(100);
  });

  test("empty probes list returns empty results", async () => {
    const results = await runProbes([], EMPTY_EVIDENCE);
    expect(results).toEqual([]);
  });
});
