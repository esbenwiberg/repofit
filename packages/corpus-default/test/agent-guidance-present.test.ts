import { describe, expect, test } from "vitest";
import type { EvidenceMap, GuidanceFile } from "@esbenwiberg/repofit/sdk";
import probe from "../src/probes/agent-guidance-present.js";

function mkEvidence(guidance: GuidanceFile[]): EvidenceMap {
  const present = new Set(guidance.map((g) => g.path));
  return {
    agent_config: {
      guidance,
      has: (p: string) => present.has(p),
    },
    files: {
      has: () => false,
    },
  };
}

describe("agent.guidance-present probe", () => {
  test("identity", () => {
    expect(probe.id).toBe("agent.guidance-present");
    expect(probe.dimensions[0]?.id).toBe("context");
    expect(probe.tier).toBe("static");
    expect(probe.evidence).toContain("agent_config");
  });

  test("guidance present → predicate true", async () => {
    const reading = await probe.detect(mkEvidence([{ path: "CLAUDE.md", bytes: 100 }]));
    expect(reading).toEqual({ kind: "predicate", value: true });
  });

  test("no guidance → predicate false", async () => {
    const reading = await probe.detect(mkEvidence([]));
    expect(reading).toEqual({ kind: "predicate", value: false });
  });

  test("declared fixtures match detector output", async () => {
    for (const fx of probe.fixtures) {
      const guidance = (fx.evidence.agent_config as { guidance: GuidanceFile[] }).guidance;
      const reading = await probe.detect(mkEvidence(guidance));
      expect(reading).toEqual(fx.expect.reading);
    }
  });
});
