import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { aggregate } from "../aggregator/index.js";
import { gatherAll } from "../evidence/registry.js";
import { BASELINE_FILENAME, loadBaseline } from "../loader/baseline.js";
import {
  CONFIG_FILENAME,
  DEFAULT_CONFIG,
  loadProjectConfig,
  type ProjectConfig,
  splitInclude,
} from "../loader/config.js";
import { type LoadedCorpus, loadCorpora } from "../loader/corpus.js";
import { effectiveDimensions } from "../loader/effective-dimensions.js";
import { loadReporterPlugins } from "../loader/reporters.js";
import { renderCi } from "../reporters/ci.js";
import { renderHtml } from "../reporters/html.js";
import { renderHuman } from "../reporters/human-minimal.js";
import { buildReport, type ReportInput, renderJson } from "../reporters/json.js";
import { renderMarkdown } from "../reporters/markdown.js";
import { renderSarif } from "../reporters/sarif.js";
import { DEFAULT_TIERS, runProbesDetailed } from "../runner/tiered.js";
import type { Tier } from "../sdk/types.js";
import { gitHeadCommit, gitIgnoresPath } from "../util/git.js";
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
  include?: string[];
  noCache?: boolean;
  judgeTransport?: "api" | "cli" | "openai" | "codex";
  /**
   * Pairs of `name=path` strings dispatched to reporter plugins loaded from
   * `repofit.config.json#reporters.plugins`. The reporter's render output
   * is written to the path.
   */
  reporter?: string[];
};

export async function check(opts: CheckOptions): Promise<number> {
  if (opts.init) {
    const defaultCorpus = await loadCorpora();
    const created = await writeInitialConfig({ cwd: opts.cwd, corpus: defaultCorpus });
    console.log(
      `wrote ${CONFIG_FILENAME} (corpus pinned: ${created.corpus?.[0]?.package}@${created.corpus?.[0]?.version})`,
    );
    console.log("gate mode: advisory (run `repofit check --accept` to enable ratchet)");
    return 0;
  }

  const [projectConfig, baseline] = await Promise.all([
    loadProjectConfig(opts.cwd),
    loadBaseline(opts.cwd),
  ]);
  const config: ProjectConfig = projectConfig ?? DEFAULT_CONFIG;
  const evidence = await gatherAll({
    cwd: opts.cwd,
    judge: { noCache: opts.noCache, transport: opts.judgeTransport },
    toolchain: config.toolchain,
  });
  const corpus = await loadCorpora({ packages: config.corpus?.map((c) => c.package) });
  reportCorpusOverrides(corpus, opts.output);
  reportUnknownProbeReferences(corpus, config, opts, opts.output);

  const probes = opts.probe ? corpus.probes.filter((p) => p.id === opts.probe) : corpus.probes;
  if (opts.probe && probes.length === 0) {
    console.error(`probe '${opts.probe}' not found in corpus '${corpus.name}'`);
    return 2;
  }

  const { includeTiers, includeProbes } = resolveInclude(opts.include, config, opts.probe);
  const summary = await runProbesDetailed(probes, evidence, {
    waivers: config.waivers,
    includeTiers,
    includeProbes,
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
    toolchain: { stacks: evidence.toolchain.stacks, primary: evidence.toolchain.primary },
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

  const reporterOutputs = await runReporterPlugins(opts, reportInput, config);

  await warnUnignoredArtifacts(opts.cwd, [
    opts.artifact,
    opts.html,
    opts.sarif,
    opts.comment,
    ...reporterOutputs.map((r) => r.path),
  ]);

  if (output === "human") {
    console.log(
      renderHuman({
        aggregated,
        results,
        verdict,
        drift,
        cost,
        toolchain: { stacks: evidence.toolchain.stacks, primary: evidence.toolchain.primary },
      }),
    );
    printArtifactLinks(
      artifactLinks([
        ["html", opts.html],
        ["sarif", opts.sarif],
        ["comment", opts.comment],
        ...reporterOutputs.map((out) => [out.name, out.path] as const),
      ]),
      console.log,
    );
    return verdict.pass ? 0 : 1;
  }

  if (output === "json") {
    process.stdout.write(renderJson(reportInput));
    printArtifactLinks(
      artifactLinks([
        ["html", opts.html],
        ["sarif", opts.sarif],
        ["comment", opts.comment],
        ...reporterOutputs.map((out) => [out.name, out.path] as const),
      ]),
      console.error,
    );
    return verdict.pass ? 0 : 1;
  }

  const githubActions = process.env.GITHUB_ACTIONS === "true";
  const rendered = await renderCi({ ...reportInput, githubActions, artifactPath: opts.artifact });
  console.log(rendered.stdout);
  for (const line of rendered.annotations) console.log(line);
  printArtifactLinks(
    artifactLinks([
      ["json", rendered.artifactWritten],
      ["html", opts.html],
      ["sarif", opts.sarif],
      ["comment", opts.comment],
      ...reporterOutputs.map((out) => [out.name, out.path] as const),
    ]),
    console.log,
  );
  return verdict.pass ? 0 : 1;
}

/**
 * `--include` on the command line replaces `gate.include`; both name opt-in
 * tiers and opt-in probe ids. A probe selected with `--probe` runs even when
 * it is opt-in: naming it is the opt-in.
 */
function resolveInclude(
  cliInclude: string[] | undefined,
  config: ProjectConfig,
  selectedProbe: string | undefined,
): { includeTiers: ReadonlySet<Tier>; includeProbes: ReadonlySet<string> } {
  const extra = cliInclude && cliInclude.length > 0 ? cliInclude : (config.gate.include ?? []);
  const { tiers, probeIds } = splitInclude(extra);
  if (selectedProbe) probeIds.add(selectedProbe);
  return {
    includeTiers: tiers.size === 0 ? DEFAULT_TIERS : new Set<Tier>([...DEFAULT_TIERS, ...tiers]),
    includeProbes: probeIds,
  };
}

/**
 * A config that names a probe the corpus no longer ships is silently inert:
 * a disabled or waived id matches nothing, and an opt-in id includes nothing.
 * Say so, naming the replacement when the corpus records one.
 */
function reportUnknownProbeReferences(
  corpus: LoadedCorpus,
  config: ProjectConfig,
  opts: Pick<CheckOptions, "include">,
  output: OutputMode | undefined,
): void {
  if (output === "json") return;
  const known = new Set(corpus.probes.map((p) => p.id));
  const referenced = new Map<string, string>();
  for (const [dimId, dim] of Object.entries(config.dimensions ?? {})) {
    for (const id of Object.keys(dim.probes ?? {}))
      referenced.set(id, `dimensions.${dimId}.probes`);
  }
  for (const id of Object.keys(config.probes ?? {})) referenced.set(id, "probes");
  for (const w of config.waivers ?? []) referenced.set(w.probeId, "waivers");
  const include =
    opts.include && opts.include.length > 0 ? opts.include : (config.gate.include ?? []);
  for (const id of splitInclude(include).probeIds) {
    referenced.set(id, opts.include && opts.include.length > 0 ? "--include" : "gate.include");
  }
  for (const [id, where] of referenced) {
    if (known.has(id)) continue;
    const replacement = corpus.retired[id];
    const hint =
      replacement !== undefined
        ? replacement === null
          ? `removed from ${corpus.name}@${corpus.version} with no replacement`
          : `removed from ${corpus.name}@${corpus.version}; its replacement is '${replacement}'`
        : `not in ${corpus.name}@${corpus.version}`;
    console.error(`warning: ${where} names probe '${id}', which is ${hint}`);
  }
}

function fmt(n: number | null): string {
  return n === null ? "—" : n.toFixed(0);
}

function reportCorpusOverrides(corpus: LoadedCorpus, output: OutputMode | undefined): void {
  if (output === "json" || corpus.overrides.length === 0) return;
  const ids = corpus.overrides.map((o) => `${o.kind} ${o.id} (${o.from} → ${o.to})`);
  const head = ids.length === 1 ? "corpus override:" : `corpus overrides (${ids.length}):`;
  console.error(head);
  for (const line of ids) console.error(`  ${line}`);
}

/**
 * repofit's own report artifacts land in the working tree. If git doesn't
 * ignore them, tree-scanning probes (format.clean, lint, …) pick them up on
 * the next run — repofit tripping its own probes on its own output. Warn so
 * the false signal is obvious and fixable.
 */
type ReporterDispatch = { name: string; path: string };
type ArtifactLink = { label: string; path: string; href: string };

function artifactLinks(
  entries: ReadonlyArray<readonly [string, string | undefined]>,
): ArtifactLink[] {
  return entries.flatMap(([label, path]) =>
    path ? [{ label, path, href: pathToFileURL(resolve(path)).href }] : [],
  );
}

function printArtifactLinks(
  links: ReadonlyArray<ArtifactLink>,
  write: (line: string) => void,
): void {
  if (links.length === 0) return;
  write("");
  write(links.length === 1 ? "report artifact:" : "report artifacts:");
  for (const link of links) write(`  ${link.label.padEnd(8)} ${link.href}`);
}

async function runReporterPlugins(
  opts: CheckOptions,
  reportInput: ReportInput,
  config: ProjectConfig,
): Promise<ReporterDispatch[]> {
  if (!opts.reporter || opts.reporter.length === 0) return [];

  const dispatches: ReporterDispatch[] = [];
  for (const spec of opts.reporter) {
    const eq = spec.indexOf("=");
    if (eq <= 0 || eq === spec.length - 1) {
      throw new Error(`--reporter expects 'name=path', got '${spec}'`);
    }
    dispatches.push({ name: spec.slice(0, eq), path: spec.slice(eq + 1) });
  }

  const loaded = await loadReporterPlugins(config.reporters?.plugins);
  const byName = new Map(loaded.map((l) => [l.reporter.name, l]));

  for (const d of dispatches) {
    const entry = byName.get(d.name);
    if (!entry) {
      const known =
        [...byName.keys()].sort().join(", ") ||
        "(none — declare in repofit.config.json#reporters.plugins)";
      throw new Error(`no reporter named '${d.name}' is registered. Known: ${known}`);
    }
    const output = await entry.reporter.render({
      cwd: reportInput.cwd,
      report: buildReport(reportInput),
      options: entry.options,
    });
    await writeFile(d.path, output, "utf8");
  }
  return dispatches;
}

async function warnUnignoredArtifacts(
  cwd: string,
  paths: ReadonlyArray<string | undefined>,
): Promise<void> {
  const unignored: string[] = [];
  for (const path of paths) {
    if (!path) continue;
    if ((await gitIgnoresPath(cwd, path)) === false) unignored.push(path);
  }
  if (unignored.length === 0) return;

  const noun = unignored.length === 1 ? "an output artifact" : "output artifacts";
  console.error(`\nwarning: wrote ${noun} that git does not ignore:`);
  for (const path of unignored) console.error(`  ${path}`);
  console.error(
    "These files stay in the working tree, so tree-scanning probes (format.clean,\n" +
      "lint, …) will read them on the next run — a false signal about your codebase.\n" +
      "Add them to .gitignore, or write reports into an already-ignored dir (e.g. .repofit/).",
  );
}
