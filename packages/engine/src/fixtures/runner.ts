import { isDeepStrictEqual } from "node:util";
import ignore from "ignore";
import { score as scoreReading } from "../scorer/index.js";
import type {
  AgentConfigEvidence,
  BranchProtectionResult,
  CiWorkflowsEvidence,
  CommandRun,
  CommandSpec,
  CommandsEvidence,
  CommitHistoryEvidence,
  DotnetProjectEvidence,
  EvidenceMap,
  FilesEvidence,
  Fixture,
  GithubApiEvidence,
  GitignoreEvidence,
  GoModuleEvidence,
  GuidanceFile,
  JudgeBand,
  JudgeEvidence,
  JudgeRequest,
  JudgeResult,
  NodePackageEvidence,
  Probe,
  PythonProjectEvidence,
  Reading,
  SizeStatsEvidence,
  ToolchainEvidence,
} from "../sdk/types.js";
import { errorMessage } from "../util/error-message.js";

export type FixtureOutcome =
  | { ok: true; reading: Reading; score: number | null }
  | { ok: false; reason: string };

export async function runFixture(probe: Probe, fixture: Fixture): Promise<FixtureOutcome> {
  const evidence = hydrateFixtureEvidence(fixture.evidence);

  let reading: Reading;
  try {
    reading = await probe.detect(evidence);
  } catch (err) {
    return { ok: false, reason: `detect threw: ${errorMessage(err)}` };
  }

  if (!isDeepStrictEqual(reading, fixture.expect.reading)) {
    return {
      ok: false,
      reason: `reading mismatch:\n  expected ${JSON.stringify(fixture.expect.reading)}\n  got      ${JSON.stringify(reading)}`,
    };
  }

  let s: number | null;
  try {
    s = scoreReading(reading, probe.score);
  } catch (err) {
    return { ok: false, reason: `score threw: ${errorMessage(err)}` };
  }

  if (s !== fixture.expect.score) {
    return { ok: false, reason: `score mismatch: expected ${fixture.expect.score}, got ${s}` };
  }

  return { ok: true, reading, score: s };
}

function hydrateFixtureEvidence(raw: Record<string, unknown>): EvidenceMap {
  return {
    files: hydrateFiles(raw.files),
    agent_config: hydrateAgentConfig(raw.agent_config),
    node_package: hydrateNodePackage(raw.node_package),
    python_project: hydratePythonProject(raw.python_project),
    dotnet_project: hydrateDotnetProject(raw.dotnet_project),
    go_module: hydrateGoModule(raw.go_module),
    toolchain: hydrateToolchain(raw.toolchain),
    gitignore: hydrateGitignore(raw.gitignore),
    size_stats: hydrateSizeStats(raw.size_stats),
    ci_workflows: hydrateCiWorkflows(raw.ci_workflows),
    commit_history: hydrateCommitHistory(raw.commit_history),
    commands: hydrateCommands(raw.commands),
    github_api: hydrateGithubApi(raw.github_api),
    judge: hydrateJudge(raw.judge),
  };
}

function hydrateFiles(raw: unknown): FilesEvidence {
  let paths: Set<string>;
  let contents: Map<string, string>;
  if (Array.isArray(raw)) {
    paths = new Set(raw as string[]);
    contents = new Map();
  } else if (raw && typeof raw === "object") {
    const map = raw as Record<string, string>;
    paths = new Set(Object.keys(map));
    contents = new Map(Object.entries(map));
  } else {
    paths = new Set();
    contents = new Map();
  }
  return {
    has: (p) => paths.has(p),
    readText: async (p) => contents.get(p),
  };
}

function hydrateAgentConfig(raw: unknown): AgentConfigEvidence {
  const obj = (raw ?? {}) as { guidance?: GuidanceFile[] };
  const guidance = obj.guidance ?? [];
  const present = new Set(guidance.map((g) => g.path));
  return { guidance, has: (p) => present.has(p) };
}

function hydrateNodePackage(raw: unknown): NodePackageEvidence {
  if (!raw || typeof raw !== "object") {
    return {
      present: false,
      dependencies: {},
      devDependencies: {},
      scripts: {},
      raw: null,
    };
  }
  const obj = raw as Partial<NodePackageEvidence>;
  return {
    present: obj.present ?? true,
    dependencies: obj.dependencies ?? {},
    devDependencies: obj.devDependencies ?? {},
    scripts: obj.scripts ?? {},
    raw: obj.raw ?? null,
  };
}

function hydratePythonProject(raw: unknown): PythonProjectEvidence {
  if (!raw || typeof raw !== "object") {
    return {
      present: false,
      pyproject: null,
      requirementsFiles: [],
      requirementsToolHints: [],
      configFiles: [],
      hasPoetryLock: false,
      hasUvLock: false,
      hasPipfileLock: false,
      hasSetupCfg: false,
      hasSetupPy: false,
    };
  }
  const obj = raw as Partial<PythonProjectEvidence>;
  return {
    present: obj.present ?? true,
    pyproject: obj.pyproject ?? null,
    requirementsFiles: obj.requirementsFiles ?? [],
    requirementsToolHints: obj.requirementsToolHints ?? [],
    configFiles: obj.configFiles ?? [],
    hasPoetryLock: obj.hasPoetryLock ?? false,
    hasUvLock: obj.hasUvLock ?? false,
    hasPipfileLock: obj.hasPipfileLock ?? false,
    hasSetupCfg: obj.hasSetupCfg ?? false,
    hasSetupPy: obj.hasSetupPy ?? false,
  };
}

function hydrateDotnetProject(raw: unknown): DotnetProjectEvidence {
  if (!raw || typeof raw !== "object") {
    return { present: false, solutions: [], projects: [], centralPackageManagement: null };
  }
  const obj = raw as Partial<DotnetProjectEvidence>;
  return {
    present: obj.present ?? true,
    solutions: obj.solutions ?? [],
    projects: obj.projects ?? [],
    centralPackageManagement: obj.centralPackageManagement ?? null,
  };
}

function hydrateGoModule(raw: unknown): GoModuleEvidence {
  if (!raw || typeof raw !== "object") {
    return { present: false, modules: [] };
  }
  const obj = raw as Partial<GoModuleEvidence>;
  return {
    present: obj.present ?? true,
    modules: obj.modules ?? [],
  };
}

function hydrateToolchain(raw: unknown): ToolchainEvidence {
  if (!raw || typeof raw !== "object") {
    return {
      stacks: [],
      primary: null,
      commands: { build: null, test: null, lint: null, typecheck: null, format: null },
    };
  }
  const obj = raw as Partial<ToolchainEvidence>;
  return {
    stacks: obj.stacks ?? [],
    primary: obj.primary ?? null,
    commands: {
      build: obj.commands?.build ?? null,
      test: obj.commands?.test ?? null,
      lint: obj.commands?.lint ?? null,
      typecheck: obj.commands?.typecheck ?? null,
      format: obj.commands?.format ?? null,
    },
  };
}

function hydrateGitignore(raw: unknown): GitignoreEvidence {
  if (!raw || typeof raw !== "object") {
    return { present: false, patterns: [], ignores: () => false };
  }
  const obj = raw as { patterns?: string[]; present?: boolean };
  const patterns = obj.patterns ?? [];
  const matcher = ignore().add(patterns);
  return {
    present: obj.present ?? patterns.length > 0,
    patterns,
    ignores: (p) => matcher.ignores(p),
  };
}

function hydrateSizeStats(raw: unknown): SizeStatsEvidence {
  if (!raw || typeof raw !== "object") {
    return { files: [], totalBytes: 0, totalFiles: 0, source: "none" };
  }
  const obj = raw as Partial<SizeStatsEvidence>;
  return {
    files: obj.files ?? [],
    totalBytes: obj.totalBytes ?? 0,
    totalFiles: obj.totalFiles ?? obj.files?.length ?? 0,
    totalBytesEffective: obj.totalBytesEffective,
    totalFilesEffective: obj.totalFilesEffective,
    source: obj.source ?? "git-ls-files",
  };
}

function hydrateCiWorkflows(raw: unknown): CiWorkflowsEvidence {
  if (!raw || typeof raw !== "object") {
    return { present: false, workflows: [] };
  }
  const obj = raw as Partial<CiWorkflowsEvidence>;
  const workflows = obj.workflows ?? [];
  return { present: obj.present ?? workflows.length > 0, workflows };
}

function hydrateCommitHistory(raw: unknown): CommitHistoryEvidence {
  if (!raw || typeof raw !== "object") {
    return { available: false, commits: [] };
  }
  const obj = raw as Partial<CommitHistoryEvidence>;
  return { available: obj.available ?? true, commits: obj.commits ?? [] };
}

function hydrateGithubApi(raw: unknown): GithubApiEvidence {
  const fixture = (raw ?? null) as { branchProtection?: BranchProtectionResult } | null;
  return {
    async branchProtection(): Promise<BranchProtectionResult> {
      return fixture?.branchProtection ?? { kind: "unavailable", reason: "fixture: not provided" };
    },
  };
}

type JudgeFixture = {
  score?: JudgeBand;
  perCriterion?: Record<string, JudgeBand>;
  rationale?: string;
  model?: string;
};

function hydrateJudge(raw: unknown): JudgeEvidence {
  const fixture = (raw && typeof raw === "object" ? raw : null) as JudgeFixture | null;
  return {
    defaultModel: fixture?.model ?? "fixture",
    async score(req: JudgeRequest): Promise<JudgeResult> {
      if (!fixture) {
        throw new Error(`judge: fixture not provided for probe '${req.probeId}'`);
      }
      return {
        score: fixture.score ?? 0,
        perCriterion: fixture.perCriterion ?? {},
        rationale: fixture.rationale ?? "",
        model: fixture.model ?? "fixture",
        fromCache: false,
      };
    },
  };
}

type CommandFixture = Partial<CommandRun> & { argv: string[] };

function hydrateCommands(raw: unknown): CommandsEvidence {
  const entries = Array.isArray(raw) ? (raw as CommandFixture[]) : [];
  return {
    async run(spec: CommandSpec): Promise<CommandRun> {
      const key = spec.argv.join(" ");
      const match = entries.find((e) => e.argv.join(" ") === key);
      return {
        exitCode: match?.exitCode ?? null,
        durationMs: match?.durationMs ?? 0,
        stdout: match?.stdout ?? "",
        stderr: match?.stderr ?? "",
        timedOut: match?.timedOut ?? false,
      };
    },
  };
}
