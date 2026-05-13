export { type FixtureOutcome, runFixture } from "../fixtures/runner.js";
export { defineDimension } from "./define-dimension.js";
export { defineFixer } from "./define-fixer.js";
export { defineProbe } from "./define-probe.js";
export type {
  AgentConfigEvidence,
  Band,
  DimensionAssignment,
  DimensionOverride,
  DimensionRecipe,
  EvidenceMap,
  FilesEvidence,
  FixAction,
  FixActionAppendLines,
  FixActionWriteFile,
  FixContext,
  Fixer,
  FixPlan,
  Fixture,
  FixtureExpect,
  GatherContext,
  GitignoreEvidence,
  GuidanceFile,
  InventoryItem,
  Location,
  NodePackageEvidence,
  Probe,
  Reading,
  ScoreConfig,
  Severity,
  Tier,
} from "./types.js";
