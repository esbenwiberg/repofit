import type { CommandExecution, InventoryItem, JudgeEvidence, Location } from "../../sdk/types.js";

export const INDEX_VERSION = "lexical-ts-csharp-v1";
export const GROUP_VERSION = "generic-structural-v1";
export const RULE_VERSION = "declared-policy-v1";
export const PROMPT_VERSION = "contradiction-evidence-v1";
export type Fact = {
  name: string;
  location: Location;
  calls: { name: string; line: number }[];
  annotations: string[];
  behavior: string[];
  shape: string;
  excerpt: string;
};
export type TextFact = {
  kind: "comment" | "documentation" | "example";
  line: number;
  text: string;
};
export type FileFacts = {
  path: string;
  hash: string;
  stamp: string;
  adapter: "typescript" | "csharp" | "documentation" | "configuration";
  imports: { name: string; line: number }[];
  symbols: Fact[];
  texts: TextFact[];
  contracts: boolean;
  truncated: string[];
  unknowns: string[];
};
export type ManifestEntry = {
  path: string;
  status: "included" | "excluded" | "unparsed" | "truncated";
  reason?: string;
};
export type StructuralIndex = {
  version: string;
  source: "git-index" | "filesystem";
  files: Record<string, FileFacts>;
  manifest: ManifestEntry[];
  coverage: Record<ManifestEntry["status"], number>;
  stats: { read: number; reused: number; deleted: number };
  unknowns: string[];
};
export type PolicyRule = {
  id: string;
  kind: "restricted-call" | "restricted-import" | "module-boundary" | "required-call";
  scope: string[];
  match: string;
  allowed?: string[];
  replacement?: string;
  rationale: string;
  documentation?: string[];
};
export type PolicyExperiment = {
  id: string;
  argv: string[];
  valid: { path: string; content: string };
  invalid: { path: string; content: string };
  expectedDiagnostic: string;
  timeoutMs?: number;
};
export type Policy = { version: 1; rules: PolicyRule[]; experiments?: PolicyExperiment[] };
export type Finding = InventoryItem & {
  kind: "policy" | "suppression" | "misleading-example" | "candidate" | "contradiction";
  confidence: "deterministic" | "heuristic" | "judged";
  ruleId?: string;
  relatedLocations: Location[];
};
export type Packet = {
  id: string;
  group: string;
  dependencyHash: string;
  locations: Location[];
  input: string;
  truncated: boolean;
};
export type ExperimentResult = {
  id: string;
  configured: true;
  executed: boolean;
  integrity?: "unchanged" | "mutated" | "unknown";
  acceptsLegitimate: boolean | null;
  rejectsInvalid: boolean | null;
  reason?: string;
  executions: CommandExecution[];
};
export type AnalysisReport = {
  version: 1;
  advisory: true;
  versions: { index: string; grouping: string; rules: string; prompt: string };
  index: StructuralIndex;
  policy: {
    configured: boolean;
    findings: Finding[];
    unknowns: string[];
    experiments: ExperimentResult[];
  };
  discovery: {
    packets: Packet[];
    findings: Finding[];
    omittedGroups: number;
    omittedMemberships: number;
    unknowns: string[];
  };
  readiness: {
    path?: string;
    declared: unknown;
    observed: unknown[];
    inferred: string[];
    unknowns: string[];
  };
};
export type AnalysisEvidence = { inspect(): Promise<AnalysisReport> };
export type AnalysisOptions = { rehash?: boolean; judge?: JudgeEvidence; experiment?: boolean };
