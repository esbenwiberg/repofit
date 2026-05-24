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

export type PyProjectInfo = {
  path: string;
  hasBuildSystem: boolean;
  /**
   * `[tool.X]` section names found in pyproject.toml. e.g. `["ruff", "mypy",
   * "pytest"]`. Used by the toolchain abstraction to pick a lint/format/test
   * command for the Python stack.
   */
  tools: string[];
  /**
   * Known Python tooling package names mentioned anywhere in pyproject.toml.
   * This intentionally stays small and tool-focused so the default corpus can
   * infer safe commands from dependency declarations without needing a full TOML
   * parser in the evidence layer.
   */
  toolHints?: string[];
  projectName?: string;
};

export type PythonProjectEvidence = {
  present: boolean;
  pyproject: PyProjectInfo | null;
  requirementsFiles: string[];
  /** Known Python tooling package names mentioned in requirements*.txt files. */
  requirementsToolHints?: string[];
  /** Common Python tool config files tracked in the repo. */
  configFiles?: string[];
  hasPoetryLock: boolean;
  hasUvLock: boolean;
  hasPipfileLock: boolean;
  hasSetupCfg: boolean;
  hasSetupPy: boolean;
};

export type DotnetProjectInfo = {
  path: string;
  kind: "csproj" | "fsproj" | "vbproj";
  sdk?: string;
  targetFrameworks: string[];
  /** Package name → version. Version is "" when Central Package Management resolves it. */
  packageReferences: Record<string, string>;
};

export type CentralPackagesInfo = {
  path: string;
  packageVersions: Record<string, string>;
};

export type DotnetProjectEvidence = {
  present: boolean;
  solutions: string[];
  projects: DotnetProjectInfo[];
  centralPackageManagement: CentralPackagesInfo | null;
};

export type GoModuleInfo = {
  path: string;
  modulePath?: string;
  goVersion?: string;
  dependencies: Record<string, string>;
};

export type GoModuleEvidence = {
  present: boolean;
  modules: GoModuleInfo[];
};

export type ToolchainStack = "node" | "python" | "dotnet" | "go";

export type ToolchainPhase = "build" | "test" | "lint" | "typecheck" | "format";

export type ToolchainCommand = {
  /**
   * Where the command came from. `"explicit"` means a user override in
   * `repofit.config.json#commands.<phase>`. Otherwise the detected stack
   * whose default was used.
   */
  source: ToolchainStack | "explicit";
  /** Argv to spawn. */
  argv: string[];
};

export type ToolchainEvidence = {
  /** Supported stacks detected in this repo, in primary-first order. */
  stacks: ToolchainStack[];
  /** First entry of `stacks`, or null if none of the supported stacks were detected. */
  primary: ToolchainStack | null;
  /**
   * Resolved command per phase. `null` when no sensible default exists for the
   * primary stack and no override is configured (probes should treat as n/a).
   */
  commands: Record<ToolchainPhase, ToolchainCommand | null>;
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
  /**
   * True if the file is generated (lockfile, build output, marked
   * `linguist-generated` in `.gitattributes`). Optional for back-compat with
   * existing fixtures; absent means "not generated".
   */
  generated?: boolean;
};

export type SizeStatsEvidence = {
  files: SizeStatsFile[];
  /** Raw totals including generated files. */
  totalBytes: number;
  totalFiles: number;
  /**
   * Totals excluding generated files — what an agent actually pays to read.
   * Optional for back-compat; consumers should fall back to `totalBytes`
   * when absent.
   */
  totalBytesEffective?: number;
  totalFilesEffective?: number;
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
  python_project: PythonProjectEvidence;
  dotnet_project: DotnetProjectEvidence;
  go_module: GoModuleEvidence;
  toolchain: ToolchainEvidence;
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
  transport?: "api" | "cli" | "openai" | "codex";
};

export type ToolchainContext = {
  /** Per-phase argv overrides from `repofit.config.json#commands`. */
  commands?: Partial<Record<ToolchainPhase, string[]>>;
  /** Override the auto-detected primary stack. */
  primaryStack?: ToolchainStack;
};

export type GatherContext = {
  cwd: string;
  judge?: JudgeOptions;
  toolchain?: ToolchainContext;
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

/**
 * Context passed to a third-party reporter's `render` function. `report` is
 * the structured JSON report — the same shape `repofit check --json` emits,
 * minus the `$schema` and `tool` fields a custom reporter usually doesn't
 * care about. `options` is the free-form blob from
 * `repofit.config.json#reporters[i].options`.
 */
export type ReporterContext = {
  cwd: string;
  report: unknown;
  options: Record<string, unknown>;
};

export type Reporter = {
  /** Stable id. Invoked via `repofit check --reporter <name>=<path>`. */
  name: string;
  /** One-liner shown in CLI help / errors. */
  describe?: string;
  /** Produce the reporter's output. Engine writes it to the user-specified path. */
  render(ctx: ReporterContext): string | Promise<string>;
};
