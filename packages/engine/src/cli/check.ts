import { aggregate } from "../aggregator/index.js";
import { gatherAll } from "../evidence/registry.js";
import { BASELINE_FILENAME, loadBaseline } from "../loader/baseline.js";
import {
  CONFIG_FILENAME,
  DEFAULT_CONFIG,
  loadProjectConfig,
  type ProjectConfig,
} from "../loader/config.js";
import { loadDefaultCorpus } from "../loader/corpus.js";
import { effectiveDimensions } from "../loader/effective-dimensions.js";
import { renderCi } from "../reporters/ci.js";
import { renderHuman } from "../reporters/human-minimal.js";
import { type ReportInput, renderJson } from "../reporters/json.js";
import { runProbes } from "../runner/tiered.js";
import { gitHeadCommit } from "../util/git.js";
import { detectDrift } from "../verdict/drift.js";
import { computeVerdict } from "../verdict/index.js";
import { writeAcceptedBaseline, writeInitialConfig } from "./bootstrap.js";

export type OutputMode = "human" | "json" | "ci";

export type CheckOptions = {
  cwd: string;
  probe?: string | undefined;
  init?: boolean;
  accept?: boolean;
  dirty?: boolean;
  output?: OutputMode;
  artifact?: string | undefined;
};

export async function check(opts: CheckOptions): Promise<number> {
  const corpus = await loadDefaultCorpus();

  if (opts.init) {
    const created = await writeInitialConfig({ cwd: opts.cwd, corpus });
    console.log(
      `wrote ${CONFIG_FILENAME} (corpus pinned: ${created.corpus?.[0]?.package}@${created.corpus?.[0]?.version})`,
    );
    console.log("gate mode: advisory (run `repofit check --accept` to enable ratchet)");
    return 0;
  }

  const [projectConfig, baseline, evidence] = await Promise.all([
    loadProjectConfig(opts.cwd),
    loadBaseline(opts.cwd),
    gatherAll({ cwd: opts.cwd }),
  ]);
  const config: ProjectConfig = projectConfig ?? DEFAULT_CONFIG;

  const probes = opts.probe ? corpus.probes.filter((p) => p.id === opts.probe) : corpus.probes;
  if (opts.probe && probes.length === 0) {
    console.error(`probe '${opts.probe}' not found in corpus '${corpus.name}'`);
    return 2;
  }

  const results = await runProbes(probes, evidence, { waivers: config.waivers });

  const dimensions = effectiveDimensions(corpus.dimensions, config);
  const aggregated = aggregate(results, dimensions);

  if (opts.accept) {
    const probeScores: Record<string, number | null> = {};
    for (const r of results) probeScores[r.probe.id] = r.score;
    const written = await writeAcceptedBaseline({
      cwd: opts.cwd,
      corpus,
      aggregated,
      probeScores,
      allowDirty: opts.dirty,
    });
    console.log(`wrote ${BASELINE_FILENAME} (fitness: ${fmt(written.fitness)})`);
    return 0;
  }

  const verdict = computeVerdict(aggregated, config, baseline);
  const drift = detectDrift(corpus, baseline);
  const output = opts.output ?? "human";

  if (output === "human") {
    console.log(renderHuman({ aggregated, results, verdict, drift }));
    return verdict.pass ? 0 : 1;
  }

  const reportInput: ReportInput = {
    cwd: opts.cwd,
    commit: await gitHeadCommit(opts.cwd),
    corpus,
    config: {
      gateMode: config.gate.mode,
      ...(config.gate.include ? { include: config.gate.include } : {}),
    },
    aggregated,
    results,
    verdict,
    drift,
    baseline: baseline
      ? { fitness: baseline.fitness, dimensions: baseline.dimensions, probes: baseline.probes }
      : null,
  };

  if (output === "json") {
    process.stdout.write(renderJson(reportInput));
    return verdict.pass ? 0 : 1;
  }

  const githubActions = process.env.GITHUB_ACTIONS === "true";
  const rendered = await renderCi({ ...reportInput, githubActions, artifactPath: opts.artifact });
  console.log(rendered.stdout);
  for (const line of rendered.annotations) console.log(line);
  return verdict.pass ? 0 : 1;
}

function fmt(n: number | null): string {
  return n === null ? "—" : n.toFixed(0);
}
