import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Aggregated } from "../aggregator/index.js";
import { BASELINE_FILENAME, type Baseline, writeBaseline } from "../loader/baseline.js";
import { CONFIG_FILENAME, type ProjectConfig, writeProjectConfig } from "../loader/config.js";
import type { LoadedCorpus } from "../loader/corpus.js";
import { gitHeadCommit } from "../util/git.js";

const exec = promisify(execFile);

export type InitOptions = { cwd: string; corpus: LoadedCorpus; overwrite?: boolean };

export async function writeInitialConfig(opts: InitOptions): Promise<ProjectConfig> {
  const config: ProjectConfig = {
    version: 1,
    corpus: [{ package: opts.corpus.name, version: opts.corpus.version }],
    gate: { mode: "advisory" },
  };
  await writeProjectConfig(opts.cwd, config);
  return config;
}

export type AcceptOptions = {
  cwd: string;
  corpus: LoadedCorpus;
  aggregated: Aggregated;
  probeScores: Record<string, number | null>;
  acceptedBy?: string;
  allowDirty?: boolean;
};

export async function writeAcceptedBaseline(opts: AcceptOptions): Promise<Baseline> {
  if (!opts.allowDirty) {
    const dirty = await gitWorkingTreeDirty(opts.cwd);
    if (dirty) {
      throw new Error("working tree is dirty — commit/stash changes or pass --dirty to override");
    }
  }

  const commit = await gitHeadCommit(opts.cwd);

  const dimensions: Record<string, number | null> = {};
  for (const d of opts.aggregated.dimensions) dimensions[d.id] = d.score;

  const baseline: Baseline = {
    version: 1,
    acceptedAt: new Date().toISOString(),
    corpus: [{ package: opts.corpus.name, version: opts.corpus.version }],
    fitness: opts.aggregated.fitness,
    dimensions,
    probes: opts.probeScores,
  };
  if (opts.acceptedBy) baseline.acceptedBy = opts.acceptedBy;
  if (commit) baseline.commit = commit;

  await writeBaseline(opts.cwd, baseline);
  return baseline;
}

async function gitWorkingTreeDirty(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await exec("git", ["status", "--porcelain"], { cwd });
    return stdout
      .split("\n")
      .filter((line) => line.length > 0)
      .some((line) => !isExpectedDirty(line));
  } catch {
    return false;
  }
}

function isExpectedDirty(line: string): boolean {
  const path = line.slice(3).trim();
  return path === CONFIG_FILENAME || path === BASELINE_FILENAME;
}
