import { writeFile } from "node:fs/promises";
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
import { renderHtml } from "../reporters/html.js";
import { renderHuman } from "../reporters/human-minimal.js";
import { type ReportInput, renderJson } from "../reporters/json.js";
import { renderMarkdown } from "../reporters/markdown.js";
import { renderSarif } from "../reporters/sarif.js";
import { DEFAULT_TIERS, runProbesDetailed } from "../runner/tiered.js";
import type { Tier } from "../sdk/types.js";
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
  html?: string | undefined;
  sarif?: string | undefined;
  comment?: string | undefined;
  include?: Tier[];
  noCache?: boolean;
  judgeTransport?: "api" | "cli";
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
    gatherAll({
      cwd: opts.cwd,
      judge: { noCache: opts.noCache, transport: opts.judgeTransport },
    }),
  ]);
  const config: ProjectConfig = projectConfig ?? DEFAULT_CONFIG;

  const probes = opts.probe ? corpus.probes.filter((p) => p.id === opts.probe) : corpus.probes;
  if (opts.probe && probes.length === 0) {
    console.error(`probe '${opts.probe}' not found in corpus '${corpus.name}'`);
    return 2;
  }

  const includeTiers = resolveIncludeTiers(opts.include, config);
  const summary = await runProbesDetailed(probes, evidence, {
    waivers: config.waivers,
    includeTiers,
  });
  const results = summary.results;

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
  const executedMs = summary.tierWallClockMs.executed;
  const cost = executedMs > 0 ? { executedMs } : undefined;

  const reportInput: ReportInput = {
    cwd: opts.cwd,
    commit: await gitHeadCommit(opts.cwd),
    corpus,
    config: {
      gateMode: config.gate.mode,
      ...(config.gate.include ? { include: config.gate.include } : {}),
    },
    aggregated,
    effectiveDimensions: dimensions,
    results,
    verdict,
    drift,
    baseline: baseline
      ? { fitness: baseline.fitness, dimensions: baseline.dimensions, probes: baseline.probes }
      : null,
    cost,
  };

  if (opts.html) {
    await writeFile(opts.html, renderHtml(reportInput), "utf8");
  }

  if (opts.sarif) {
    await writeFile(opts.sarif, renderSarif(reportInput), "utf8");
  }

  if (opts.comment) {
    await writeFile(opts.comment, renderMarkdown(reportInput), "utf8");
  }

  if (output === "human") {
    console.log(renderHuman({ aggregated, results, verdict, drift, cost }));
    if (opts.html) console.log(`  html     ${opts.html}`);
    if (opts.sarif) console.log(`  sarif    ${opts.sarif}`);
    if (opts.comment) console.log(`  comment  ${opts.comment}`);
    return verdict.pass ? 0 : 1;
  }

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

function resolveIncludeTiers(
  cliInclude: Tier[] | undefined,
  config: ProjectConfig,
): ReadonlySet<Tier> {
  const extra = cliInclude ?? config.gate.include ?? [];
  if (extra.length === 0) return DEFAULT_TIERS;
  return new Set<Tier>([...DEFAULT_TIERS, ...extra]);
}

function fmt(n: number | null): string {
  return n === null ? "—" : n.toFixed(0);
}
