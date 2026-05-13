import { defineProbe } from "@esbenwiberg/repofit/sdk";

const DOC_PATHS = [
  "ARCHITECTURE.md",
  "docs/ARCHITECTURE.md",
  "docs/architecture.md",
  "docs/architecture",
  "docs/design",
  "design",
];

export default defineProbe({
  id: "arch.doc-present",
  version: "1.0.0",
  dimensions: [{ id: "context", weight: 1 }],
  tier: "static",
  evidence: ["files"],

  rationale: `
    A dedicated architecture document — ARCHITECTURE.md, docs/architecture/,
    docs/design/ — gives the agent a single place to learn how the system
    is shaped before touching it. Without one, architecture has to be
    inferred from filenames and the README, and the agent's first change is
    more likely to violate an invisible boundary.
  `,

  async detect(ev) {
    return { kind: "predicate", value: DOC_PATHS.some((p) => ev.files.has(p)) };
  },

  score: { kind: "predicate", direction: "positive" },

  fixtures: [
    {
      name: "architecture-md",
      evidence: { files: ["ARCHITECTURE.md"] },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "docs-design-dir",
      evidence: { files: ["docs/design"] },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "absent",
      evidence: { files: [] },
      expect: { reading: { kind: "predicate", value: false }, score: 0 },
    },
  ],
});
