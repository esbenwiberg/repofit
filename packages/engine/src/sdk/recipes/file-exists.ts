import { defineProbe } from "../define-probe.js";
import type { DimensionAssignment, Fixture, Probe, Tier } from "../types.js";

export type FileExistsRecipe = {
  id: string;
  version: string;
  dimensions: DimensionAssignment[];
  tier?: Tier;
  rationale: string;
  remediation?: string;
  path: string;
  fixtures?: Fixture[];
};

export function fileExists(spec: FileExistsRecipe): Probe {
  const fixtures: Fixture[] = spec.fixtures ?? [
    {
      name: "present",
      evidence: { files: [spec.path] },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "absent",
      evidence: { files: [] },
      expect: { reading: { kind: "predicate", value: false }, score: 0 },
    },
  ];

  return defineProbe({
    id: spec.id,
    version: spec.version,
    dimensions: spec.dimensions,
    tier: spec.tier ?? "static",
    evidence: ["files"],
    rationale: spec.rationale,
    remediation: spec.remediation,
    detect: async (ev) => ({ kind: "predicate", value: ev.files.has(spec.path) }),
    score: { kind: "predicate", direction: "positive" },
    fixtures,
  });
}
