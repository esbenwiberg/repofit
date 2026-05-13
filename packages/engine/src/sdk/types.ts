export type Location = {
  path: string;
  range?: { startLine: number; endLine?: number };
};

export type Severity = "info" | "warn" | "error";

export type InventoryItem = {
  location: Location;
  severity: Severity;
  message: string;
};

export type Reading =
  | { kind: "predicate"; value: boolean }
  | { kind: "count"; value: number; samples?: Location[] }
  | { kind: "magnitude"; value: number; unit: string }
  | { kind: "inventory"; items: InventoryItem[] }
  | { kind: "distribution"; samples: number[] }
  | {
      kind: "judge";
      score: number;
      perCriterion: Record<string, number>;
      rationale: string;
      model: string;
    }
  | { kind: "na"; reason: string }
  | { kind: "error"; error: string };

export type Band = { upTo?: number; score: number };

export type Direction = "positive" | "negative";

export type ScoreConfig =
  | { kind: "predicate"; direction: Direction }
  | { kind: "count"; direction: Direction; bands: Band[] }
  | { kind: "magnitude"; direction: Direction; bands: Band[] }
  | { kind: "inventory"; severityWeights: Record<Severity, number>; bands: Band[] }
  | {
      kind: "distribution";
      stat: "mean" | "median" | "p95" | "p99" | "max";
      bands: Band[];
    }
  | { kind: "judge" };

export const TIERS = ["static", "derived", "historical", "executed", "reasoned"] as const;
export type Tier = (typeof TIERS)[number];

export type DimensionAssignment = { id: string; weight: number };

export type FixtureExpect = { reading: Reading; score: number | null };

export type Fixture = {
  name: string;
  evidence: Record<string, unknown>;
  expect: FixtureExpect;
};

export type Probe = {
  id: string;
  version: string;
  dimensions: DimensionAssignment[];
  tier: Tier;
  evidence: readonly string[];
  rationale: string;
  detect(ev: EvidenceMap): Promise<Reading>;
  score: ScoreConfig;
  remediation?: string;
  fixtures: Fixture[];
};

export type DimensionOverride = { probeId: string; weight: number };

export type DimensionRecipe = {
  id: string;
  name: string;
  description: string;
  gating: boolean;
  overrides?: DimensionOverride[];
};

export type FilesEvidence = {
  has(path: string): boolean;
  readText(path: string): Promise<string | undefined>;
};

export type GuidanceFile = {
  path: string;
  bytes: number;
  lines: number;
};

export type AgentConfigEvidence = {
  guidance: GuidanceFile[];
  has(path: string): boolean;
};

export type NodePackageEvidence = {
  present: boolean;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
  raw: Record<string, unknown> | null;
};

export type GitignoreEvidence = {
  present: boolean;
  patterns: string[];
  ignores(path: string): boolean;
};

export type SizeStatsFile = {
  path: string;
  bytes: number;
  lines: number;
  depth: number;
};

export type SizeStatsEvidence = {
  files: SizeStatsFile[];
  totalBytes: number;
  totalFiles: number;
  source: "git-ls-files" | "walk" | "none";
};

export type CiWorkflow = {
  path: string;
  raw: string;
};

export type CiWorkflowsEvidence = {
  present: boolean;
  workflows: CiWorkflow[];
};

export type CommitRecord = {
  sha: string;
  subject: string;
  authorEmail: string;
};

export type CommitHistoryEvidence = {
  available: boolean;
  commits: CommitRecord[];
};

export type CommandSpec = {
  argv: string[];
  cwd?: string;
  timeoutMs?: number;
  warmup?: number;
  env?: Record<string, string>;
};

export type CommandRun = {
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type CommandsEvidence = {
  run(spec: CommandSpec): Promise<CommandRun>;
};

export type BranchProtectionResult =
  | { kind: "protected" }
  | { kind: "unprotected" }
  | { kind: "unavailable"; reason: string };

export type GithubApiEvidence = {
  branchProtection(branch?: string): Promise<BranchProtectionResult>;
};

export const JUDGE_BANDS = [0, 20, 50, 80, 100] as const;
export type JudgeBand = (typeof JUDGE_BANDS)[number];

export type JudgeRubricCriterion = {
  id: string;
  description: string;
};

export type JudgeRubric = {
  task: string;
  criteria: readonly JudgeRubricCriterion[];
};

export type JudgeRequest = {
  probeId: string;
  probeVersion: string;
  input: string;
  rubric: JudgeRubric;
  model?: string;
};

export type JudgeResult = {
  score: JudgeBand;
  perCriterion: Record<string, JudgeBand>;
  rationale: string;
  model: string;
  fromCache: boolean;
};

export type JudgeEvidence = {
  defaultModel: string;
  score(req: JudgeRequest): Promise<JudgeResult>;
};

export type EvidenceMap = {
  files: FilesEvidence;
  agent_config: AgentConfigEvidence;
  node_package: NodePackageEvidence;
  gitignore: GitignoreEvidence;
  size_stats: SizeStatsEvidence;
  ci_workflows: CiWorkflowsEvidence;
  commit_history: CommitHistoryEvidence;
  commands: CommandsEvidence;
  github_api: GithubApiEvidence;
  judge: JudgeEvidence;
};

export type JudgeOptions = {
  noCache?: boolean;
  model?: string;
  transport?: "api" | "cli";
};

export type GatherContext = {
  cwd: string;
  judge?: JudgeOptions;
};

export type FixActionWriteFile = {
  kind: "write-file";
  path: string;
  content: string;
  ifMissing?: boolean;
};

export type FixActionAppendLines = {
  kind: "append-lines";
  path: string;
  lines: string[];
  createIfMissing?: boolean;
};

export type FixAction = FixActionWriteFile | FixActionAppendLines;

export type FixPlan = {
  actions: FixAction[];
  notes?: string[];
};

export type FixContext = {
  cwd: string;
  probe: Probe;
  reading: Reading;
};

export type GenerateOptions = {
  model?: string;
  maxTokens?: number;
  system?: string;
};

export type Generate = (prompt: string, opts?: GenerateOptions) => Promise<string>;

export type LlmFixContext = FixContext & {
  generate: Generate;
};

export type StaticFixer = {
  probeId: string;
  mode: "static";
  describe: string;
  plan(ctx: FixContext): Promise<FixPlan | null>;
};

export type LlmFixer = {
  probeId: string;
  mode: "llm";
  describe: string;
  plan(ctx: LlmFixContext): Promise<FixPlan | null>;
};

export type Fixer = StaticFixer | LlmFixer;
