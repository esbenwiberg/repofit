import type { DimensionResult } from "../aggregator/index.js";
import { VERSION } from "../index.js";
import type { EffectiveDimension } from "../loader/effective-dimensions.js";
import type { ProbeResult } from "../runner/tiered.js";
import type { Band, Probe, Reading, ScoreConfig } from "../sdk/types.js";
import type { ReportInput } from "./json.js";

export function renderHtml(input: ReportInput): string {
  const ranAt = input.ranAt ?? new Date().toISOString();
  const fitness = input.aggregated.fitness;
  const baselineFitness = input.baseline?.fitness ?? null;
  const opportunities = computeOpportunities(
    input.results,
    input.aggregated.dimensions,
    input.effectiveDimensions,
  );

  const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>repofit report</title>
<script>${THEME_INIT}</script>
<style>${CSS}</style>
</head>`;

  const body = `<body>
<header class="hdr">
  <div class="brand">repofit <span class="ver">v${esc(VERSION)}</span></div>
  <div class="meta">
    <div>ran ${esc(formatDate(ranAt))}</div>
    ${input.commit ? `<div>commit <code>${esc(input.commit.slice(0, 7))}</code></div>` : ""}
    <div>corpus <code>${esc(input.corpus.name)}@${esc(input.corpus.version)}</code></div>
    <button class="theme-toggle" type="button" aria-label="Toggle dark mode" title="Toggle dark mode">
      <svg class="icon icon-sun" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
      <svg class="icon icon-moon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
    </button>
  </div>
</header>

<section class="hero">
  ${heroBlock(fitness, baselineFitness, input.verdict.mode, input.verdict.pass)}
  ${dimensionBars(input.aggregated.dimensions)}
</section>

${opportunities.length > 0 ? opportunitiesSection(opportunities) : ""}

<main>
${dimensionSections(input.aggregated.dimensions, input.results, input.baseline?.probes ?? {})}
</main>

${baselineSection(input)}

<footer class="ftr">
  <div>repofit ${esc(VERSION)} · gate <code>${esc(input.verdict.mode)}</code>${
    input.cost ? ` · executed tier ${(input.cost.executedMs / 1000).toFixed(1)}s` : ""
  }</div>
  <div>${input.results.length} probe${input.results.length === 1 ? "" : "s"}${
    input.config.include?.length ? ` · include: ${input.config.include.join(", ")}` : ""
  }</div>
</footer>
<script>${THEME_TOGGLE}</script>
</body>
</html>
`;

  return `${head}${body}`;
}

type Opportunity = {
  probeId: string;
  score: number;
  fitnessImpact: number;
};

function computeOpportunities(
  results: ProbeResult[],
  dimensions: DimensionResult[],
  effective: EffectiveDimension[] | undefined,
): Opportunity[] {
  const dimById = new Map(dimensions.map((d) => [d.id, d]));
  const totalDimWeight = dimensions.reduce((sum, d) => sum + (d.score === null ? 0 : d.weight), 0);
  if (totalDimWeight === 0) return [];

  const overridesByDim = new Map<string, Map<string, number>>();
  for (const ed of effective ?? []) {
    const m = new Map<string, number>();
    for (const o of ed.overrides ?? []) m.set(o.probeId, o.weight);
    overridesByDim.set(ed.id, m);
  }

  const effectiveWeight = (probeId: string, dimId: string, assignmentWeight: number): number =>
    overridesByDim.get(dimId)?.get(probeId) ?? assignmentWeight;

  const dimProbeWeightSums = new Map<string, number>();
  for (const d of dimensions) {
    let sum = 0;
    for (const r of results) {
      if (r.score === null) continue;
      const a = r.probe.dimensions.find((x) => x.id === d.id);
      if (a) sum += effectiveWeight(r.probe.id, d.id, a.weight);
    }
    dimProbeWeightSums.set(d.id, sum);
  }

  const out: Opportunity[] = [];
  for (const r of results) {
    if (r.score === null || r.score >= 100) continue;
    let impact = 0;
    for (const a of r.probe.dimensions) {
      const dim = dimById.get(a.id);
      if (!dim || dim.score === null) continue;
      const w = effectiveWeight(r.probe.id, a.id, a.weight);
      if (w <= 0) continue;
      const dimProbeWeight = dimProbeWeightSums.get(a.id) ?? 0;
      if (dimProbeWeight === 0) continue;
      const probeShareInDim = w / dimProbeWeight;
      const dimShareInFitness = dim.weight / totalDimWeight;
      impact += (100 - r.score) * probeShareInDim * dimShareInFitness;
    }
    if (impact > 0.05) {
      out.push({ probeId: r.probe.id, score: r.score, fitnessImpact: impact });
    }
  }
  out.sort((a, b) => b.fitnessImpact - a.fitnessImpact);
  return out.slice(0, 6);
}

function heroBlock(
  fitness: number | null,
  baselineFitness: number | null,
  mode: string,
  pass: boolean,
): string {
  const score = fitness === null ? "—" : Math.round(fitness).toString();
  const gateClass = pass ? "ok" : "bad";
  const gateText = pass ? "PASS" : "FAIL";
  const delta =
    fitness === null || baselineFitness === null
      ? ""
      : `<div class="delta ${deltaClass(fitness - baselineFitness)}">${signed(
          Math.round(fitness) - Math.round(baselineFitness),
        )} vs baseline</div>`;
  return `<div class="fitness">
  <div class="score">${score}</div>
  <div class="label">FITNESS</div>
  <div class="gate ${gateClass}">${esc(mode)} · ${gateText}</div>
  ${delta}
</div>`;
}

function dimensionBars(dims: DimensionResult[]): string {
  const rows = dims
    .map((d) => {
      const score = d.score === null ? null : Math.round(d.score);
      const width = score ?? 0;
      const label = d.gating ? `${esc(d.name)} <span class="tag">gating</span>` : esc(d.name);
      const scoreText = score === null ? "—" : String(score);
      return `<div class="dim-row">
  <a class="dim-name" href="#dim-${esc(d.id)}">${label}</a>
  <div class="dim-bar"><div class="dim-fill ${barClass(score)}" style="width:${width}%"></div></div>
  <div class="dim-score">${scoreText}</div>
</div>`;
    })
    .join("\n");
  return `<div class="dim-bars">${rows}</div>`;
}

function opportunitiesSection(ops: Opportunity[]): string {
  const rows = ops
    .map(
      (o) => `<li>
  <a href="#probe-${probeAnchor(o.probeId)}"><code>${esc(o.probeId)}</code></a>
  <span class="op-score">${Math.round(o.score)} → 100</span>
  <span class="op-impact">+${o.fitnessImpact.toFixed(1)} fitness</span>
</li>`,
    )
    .join("\n");
  return `<section class="opportunities">
  <h2>Top opportunities</h2>
  <p class="sub">Sorted by potential fitness gain. Lift these and the headline number moves.</p>
  <ol>${rows}</ol>
</section>`;
}

function dimensionSections(
  dims: DimensionResult[],
  results: ProbeResult[],
  baselineProbes: Record<string, number | null>,
): string {
  const byDim = new Map<string, ProbeResult[]>();
  for (const r of results) {
    for (const a of r.probe.dimensions) {
      const list = byDim.get(a.id) ?? [];
      list.push(r);
      byDim.set(a.id, list);
    }
  }
  return dims
    .map((d) => {
      const probes = (byDim.get(d.id) ?? []).slice().sort((a, b) => probeRank(a) - probeRank(b));
      const score = d.score === null ? "—" : Math.round(d.score).toString();
      const gatingTag = d.gating ? ` <span class="tag">gating</span>` : "";
      const probeHtml = probes
        .map((r) => probeSection(r, baselineProbes[r.probe.id] ?? null))
        .join("\n");
      return `<section class="dim" id="dim-${esc(d.id)}">
  <h2>${esc(d.name)}${gatingTag} <span class="dim-h-score">${score}</span></h2>
  ${probeHtml}
</section>`;
    })
    .join("\n");
}

function probeSection(r: ProbeResult, baseline: number | null): string {
  const id = `probe-${probeAnchor(r.probe.id)}`;
  const verdict = readingVerdict(r);
  const verdictClass = verdictClassOf(r);
  const baselineNote =
    baseline === null
      ? ""
      : r.score === null
        ? ` <span class="muted">(baseline ${baseline})</span>`
        : r.score === baseline
          ? ` <span class="muted">(baseline ${baseline})</span>`
          : ` <span class="${deltaClass(r.score - baseline)}">${signed(
              Math.round(r.score) - baseline,
            )} vs baseline ${baseline}</span>`;

  return `<details id="${id}" class="probe ${verdictClass}">
  <summary>
    <span class="p-verdict">${verdict}</span>
    <code class="p-id">${esc(r.probe.id)}</code>
    ${baselineNote}
  </summary>
  <div class="p-body">
    <div class="p-rationale">${rationaleHtml(r.probe.rationale)}</div>
    <div class="p-reading"><strong>Your reading:</strong> ${readingDetail(r.reading)}</div>
    ${scoringLadder(r.probe.score, r.reading, r.score)}
    ${remediationBlock(r)}
    ${fixturesBlock(r.probe)}
    <div class="p-debug"><code>repofit check --probe ${esc(r.probe.id)}</code> · <code>repofit explain ${esc(r.probe.id)}</code></div>
  </div>
</details>`;
}

function probeRank(r: ProbeResult): number {
  switch (r.reading.kind) {
    case "error":
      return 0;
    case "predicate":
      return r.reading.value ? 50 : 10;
    case "na":
      return 80;
    default:
      if (r.score === null) return 80;
      return r.score >= 100 ? 60 : 20 + r.score / 5;
  }
}

function readingVerdict(r: ProbeResult): string {
  switch (r.reading.kind) {
    case "predicate":
      // The score already applies the probe's direction; the raw value does not.
      return r.score === null ? (r.reading.value ? "PASS" : "FAIL") : r.score > 0 ? "PASS" : "FAIL";
    case "na":
      return "N/A";
    case "error":
      return "ERR";
    default:
      return r.score === null ? "—" : String(Math.round(r.score));
  }
}

function verdictClassOf(r: ProbeResult): string {
  switch (r.reading.kind) {
    case "predicate":
      return r.reading.value ? "v-pass" : "v-fail";
    case "na":
      return "v-na";
    case "error":
      return "v-err";
    default:
      if (r.score === null) return "v-na";
      if (r.score >= 100) return "v-pass";
      if (r.score >= 50) return "v-partial";
      return "v-fail";
  }
}

function readingDetail(reading: Reading): string {
  switch (reading.kind) {
    case "predicate":
      return reading.value ? "predicate <strong>true</strong>" : "predicate <strong>false</strong>";
    case "count":
      return `count = <strong>${reading.value}</strong>`;
    case "magnitude":
      return `<strong>${reading.value}</strong> ${esc(reading.unit)}`;
    case "inventory":
      return `<strong>${reading.items.length}</strong> finding${reading.items.length === 1 ? "" : "s"}`;
    case "distribution":
      return `<strong>${reading.samples.length}</strong> sample${reading.samples.length === 1 ? "" : "s"}`;
    case "judge":
      return `judged <strong>${reading.score}</strong>/100 by <code>${esc(reading.model)}</code>`;
    case "na":
      return `<em>not applicable — ${esc(reading.reason)}</em>`;
    case "error":
      return `<em>error — ${esc(reading.error)}</em>`;
  }
}

function scoringLadder(score: ScoreConfig, reading: Reading, currentScore: number | null): string {
  if (score.kind === "judge") {
    if (reading.kind !== "judge") return "";
    return judgeBlock(reading);
  }

  const heading = `<div class="ladder-h">Scoring (${score.kind}${
    "direction" in score ? `, ${score.direction}` : ""
  })</div>`;

  if (score.kind === "predicate") {
    const trueHit = reading.kind === "predicate" && reading.value;
    const falseHit = reading.kind === "predicate" && !reading.value;
    return `<div class="ladder">${heading}
  <div class="rung ${trueHit ? "here" : ""}">true → <strong>100</strong>${trueHit ? hereMarker() : ""}</div>
  <div class="rung ${falseHit ? "here" : ""}">false → <strong>0</strong>${falseHit ? hereMarker() : ""}</div>
</div>`;
  }

  if (score.kind === "inventory") {
    const value = reading.kind === "inventory" ? reading.items.length : null;
    return `<div class="ladder">${heading}
  ${bandsHtml(score.bands, value, currentScore)}
</div>`;
  }

  if (score.kind === "distribution") {
    const samples = reading.kind === "distribution" ? reading.samples : null;
    const stat = samples === null ? null : computeStat(samples, score.stat);
    return `<div class="ladder">${heading}
  <div class="ladder-sub">stat: ${esc(score.stat)}${stat === null ? "" : ` = <strong>${stat.toFixed(1)}</strong>`}</div>
  ${bandsHtml(score.bands, stat, currentScore)}
</div>`;
  }

  // count or magnitude
  const value = reading.kind === "count" || reading.kind === "magnitude" ? reading.value : null;
  return `<div class="ladder">${heading}
  ${bandsHtml(score.bands, value, currentScore)}
</div>`;
}

function judgeBlock(reading: Extract<Reading, { kind: "judge" }>): string {
  const rows = Object.entries(reading.perCriterion)
    .map(([id, val]) => {
      const pct = Math.max(0, Math.min(100, val));
      return `<div class="crit-row">
  <span class="crit-id">${esc(id)}</span>
  <span class="crit-bar"><span class="crit-fill" style="width:${pct}%"></span></span>
  <span class="crit-val">${val}</span>
</div>`;
    })
    .join("\n  ");
  return `<div class="ladder judge">
  <div class="ladder-h">Judge feedback — LLM-rated by <code>${esc(reading.model)}</code></div>
  <div class="crit-list">
  ${rows}
  </div>
  <blockquote class="judge-rationale">${esc(reading.rationale)}</blockquote>
</div>`;
}

function bandsHtml(bands: Band[], value: number | null, currentScore: number | null): string {
  return bands
    .map((b) => {
      const hit = value !== null && currentScore !== null && b.score === currentScore;
      const label = b.upTo === undefined ? "default" : `≤ ${b.upTo}`;
      return `<div class="rung ${hit ? "here" : ""}">${esc(label)} → <strong>${b.score}</strong>${hit ? hereMarker() : ""}</div>`;
    })
    .join("\n  ");
}

function hereMarker(): string {
  return ` <span class="here-mark">◀ you are here</span>`;
}

function computeStat(samples: number[], stat: "mean" | "median" | "p95" | "p99" | "max"): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  switch (stat) {
    case "mean":
      return sorted.reduce((s, n) => s + n, 0) / sorted.length;
    case "median":
      return sorted[Math.floor(sorted.length / 2)] ?? 0;
    case "p95":
      return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
    case "p99":
      return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ?? 0;
    case "max":
      return sorted[sorted.length - 1] ?? 0;
  }
}

function remediationBlock(r: ProbeResult): string {
  if (!r.probe.remediation) return "";
  if (r.reading.kind === "na" || r.reading.kind === "error") return "";
  if (r.reading.kind === "predicate" && r.reading.value) return "";
  if (r.score !== null && r.score >= 100) return "";
  return `<div class="p-remediation"><strong>How to fix:</strong> ${esc(r.probe.remediation)}</div>`;
}

function fixturesBlock(probe: Probe): string {
  if (probe.fixtures.length === 0) return "";
  const rows = probe.fixtures
    .map((f) => {
      const expected = f.expect.score === null ? "—" : String(f.expect.score);
      return `<li><code>${esc(f.name)}</code> → expect ${expected}</li>`;
    })
    .join("\n");
  return `<details class="fixtures"><summary>Fixtures (${probe.fixtures.length})</summary><ul>${rows}</ul></details>`;
}

function rationaleHtml(rationale: string): string {
  const trimmed = rationale.trim();
  if (trimmed.length === 0) return "";
  const paragraphs = trimmed
    .split(/\n\s*\n/)
    .map((p) => `<p>${esc(p.replace(/\s+/g, " ").trim())}</p>`)
    .join("");
  return paragraphs;
}

function baselineSection(input: ReportInput): string {
  const dims = input.aggregated.dimensions;
  const baselineDims = input.baseline?.dimensions ?? {};
  const haveBaseline = input.baseline !== null;
  const fitnessRow = row(
    "Fitness",
    input.aggregated.fitness,
    input.baseline?.fitness ?? null,
    false,
  );
  const dimRows = dims
    .map((d) => row(d.name, d.score, baselineDims[d.id] ?? null, d.gating))
    .join("\n");
  const drift = input.drift;
  const driftHtml = driftBlock(drift);

  if (!haveBaseline && drift.newProbes.length === 0) return "";

  return `<section class="baseline">
  <h2>Baseline</h2>
  ${haveBaseline ? `<table><tbody>${fitnessRow}${dimRows}</tbody></table>` : '<p class="sub">No baseline yet. Run <code>repofit check --accept</code> to capture one.</p>'}
  ${driftHtml}
</section>`;
}

function row(
  name: string,
  current: number | null,
  baseline: number | null,
  gating: boolean,
): string {
  const c = current === null ? "—" : Math.round(current).toString();
  const b = baseline === null ? "—" : Math.round(baseline).toString();
  const delta =
    current === null || baseline === null
      ? "—"
      : current === baseline
        ? "─"
        : `<span class="${deltaClass(current - baseline)}">${signed(
            Math.round(current) - Math.round(baseline),
          )}</span>`;
  return `<tr><th>${esc(name)}${gating ? ' <span class="tag">gating</span>' : ""}</th><td>${c}</td><td class="arrow">→</td><td>${b}</td><td class="delta-cell">${delta}</td></tr>`;
}

function driftBlock(drift: { newProbes: string[]; removedProbes: string[] }): string {
  if (drift.newProbes.length === 0 && drift.removedProbes.length === 0) return "";
  const parts: string[] = [];
  if (drift.newProbes.length > 0) {
    parts.push(
      `<p>${drift.newProbes.length} new probe${drift.newProbes.length === 1 ? "" : "s"} not yet baselined: ${drift.newProbes.map((p) => `<code>${esc(p)}</code>`).join(", ")}</p>`,
    );
    parts.push(`<pre>repofit check --accept</pre>`);
  }
  if (drift.removedProbes.length > 0) {
    parts.push(
      `<p>Stale baseline entries: ${drift.removedProbes.map((p) => `<code>${esc(p)}</code>`).join(", ")}</p>`,
    );
  }
  return `<div class="drift">${parts.join("\n")}</div>`;
}

function probeAnchor(id: string): string {
  return id.replace(/[^a-z0-9-]/gi, "-");
}

function deltaClass(diff: number): string {
  if (diff > 0) return "d-up";
  if (diff < 0) return "d-down";
  return "d-flat";
}

function signed(n: number): string {
  if (n > 0) return `+${n}`;
  return `${n}`;
}

function barClass(score: number | null): string {
  if (score === null) return "b-na";
  if (score >= 90) return "b-good";
  if (score >= 70) return "b-ok";
  if (score >= 50) return "b-warn";
  return "b-bad";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const THEME_INIT = `(()=>{try{const t=localStorage.getItem('repofit-theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t);}catch{}})();`;

const THEME_TOGGLE = `(()=>{const b=document.querySelector('.theme-toggle');if(!b)return;b.addEventListener('click',()=>{const r=document.documentElement;const cur=r.getAttribute('data-theme');const sysDark=window.matchMedia?.('(prefers-color-scheme: dark)').matches;const next=(cur?cur==='dark':sysDark)?'light':'dark';r.setAttribute('data-theme',next);try{localStorage.setItem('repofit-theme',next);}catch{}});})();`;

const CSS = `
:root {
  --bg: #fafaf9;
  --card: #ffffff;
  --surface-2: #f5f5f4;
  --surface-3: #fafafa;
  --ink: #1c1917;
  --ink-soft: #44403c;
  --muted: #78716c;
  --line: #e7e5e4;
  --accent: #0f766e;
  --accent-soft: #f5f5f4;
  --good: #16a34a;
  --ok: #65a30d;
  --warn: #ca8a04;
  --bad: #dc2626;
  --na: #a8a29e;
  --good-bg: #dcfce7;
  --good-fg: #14532d;
  --bad-bg: #fee2e2;
  --bad-fg: #7f1d1d;
  --warn-bg: #fef3c7;
  --warn-fg: #92400e;
  --partial-fg: #78350f;
  --remediation-bg: #fef3c7;
  --remediation-border: #d97706;
  --here-bg: #fef3c7;
  --here-fg: #92400e;
  --shadow: 0 1px 3px rgba(0,0,0,0.04);
  color-scheme: light;
}

[data-theme="dark"] {
  --bg: #0c0a09;
  --card: #1c1917;
  --surface-2: #292524;
  --surface-3: #14110f;
  --ink: #fafaf9;
  --ink-soft: #d6d3d1;
  --muted: #a8a29e;
  --line: #292524;
  --accent: #2dd4bf;
  --accent-soft: #292524;
  --good: #4ade80;
  --ok: #a3e635;
  --warn: #facc15;
  --bad: #f87171;
  --na: #57534e;
  --good-bg: rgba(74, 222, 128, 0.14);
  --good-fg: #86efac;
  --bad-bg: rgba(248, 113, 113, 0.14);
  --bad-fg: #fca5a5;
  --warn-bg: rgba(252, 211, 77, 0.14);
  --warn-fg: #fcd34d;
  --partial-fg: #fcd34d;
  --remediation-bg: rgba(245, 158, 11, 0.08);
  --remediation-border: #f59e0b;
  --here-bg: rgba(252, 211, 77, 0.16);
  --here-fg: #fcd34d;
  --shadow: 0 1px 3px rgba(0,0,0,0.4);
  color-scheme: dark;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0c0a09;
    --card: #1c1917;
    --surface-2: #292524;
    --surface-3: #14110f;
    --ink: #fafaf9;
    --ink-soft: #d6d3d1;
    --muted: #a8a29e;
    --line: #292524;
    --accent: #2dd4bf;
    --accent-soft: #292524;
    --good: #4ade80;
    --ok: #a3e635;
    --warn: #facc15;
    --bad: #f87171;
    --na: #57534e;
    --good-bg: rgba(74, 222, 128, 0.14);
    --good-fg: #86efac;
    --bad-bg: rgba(248, 113, 113, 0.14);
    --bad-fg: #fca5a5;
    --warn-bg: rgba(252, 211, 77, 0.14);
    --warn-fg: #fcd34d;
    --partial-fg: #fcd34d;
    --remediation-bg: rgba(245, 158, 11, 0.08);
    --remediation-border: #f59e0b;
    --here-bg: rgba(252, 211, 77, 0.16);
    --here-fg: #fcd34d;
    --shadow: 0 1px 3px rgba(0,0,0,0.4);
    color-scheme: dark;
  }
}

* { box-sizing: border-box; }
body {
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  color: var(--ink);
  background: var(--bg);
  margin: 0;
  padding: 0;
}
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
code { background: var(--surface-2); padding: 1px 5px; border-radius: 3px; color: var(--ink); }
pre { background: var(--surface-2); padding: 8px 12px; border-radius: 4px; overflow-x: auto; color: var(--ink); }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.muted { color: var(--muted); }
.tag {
  display: inline-block;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--warn-bg);
  color: var(--warn-fg);
  vertical-align: middle;
}

.hdr {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 32px;
  border-bottom: 1px solid var(--line);
  background: var(--card);
}
.brand { font-weight: 600; font-size: 16px; }
.ver { color: var(--muted); font-weight: normal; font-size: 12px; margin-left: 6px; }
.hdr .meta { display: flex; gap: 18px; font-size: 12px; color: var(--muted); align-items: center; }

.theme-toggle {
  background: transparent;
  border: 1px solid var(--line);
  color: var(--muted);
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 0;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}
.theme-toggle:hover { color: var(--ink); border-color: var(--muted); background: var(--surface-2); }
.theme-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.theme-toggle .icon-sun { display: none; }
.theme-toggle .icon-moon { display: inline; }
[data-theme="dark"] .theme-toggle .icon-sun { display: inline; }
[data-theme="dark"] .theme-toggle .icon-moon { display: none; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .theme-toggle .icon-sun { display: inline; }
  :root:not([data-theme="light"]) .theme-toggle .icon-moon { display: none; }
}

.hero {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 32px;
  padding: 32px;
  background: var(--card);
  border-bottom: 1px solid var(--line);
}
.fitness {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
.fitness .score {
  font-size: 84px;
  line-height: 1;
  font-weight: 600;
  letter-spacing: -2px;
}
.fitness .label {
  font-size: 11px;
  letter-spacing: 1.5px;
  color: var(--muted);
}
.gate {
  margin-top: 8px;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.gate.ok { background: var(--good-bg); color: var(--good-fg); }
.gate.bad { background: var(--bad-bg); color: var(--bad-fg); }
.delta { font-size: 12px; color: var(--muted); }
.d-up { color: var(--good); }
.d-down { color: var(--bad); }
.d-flat { color: var(--muted); }

.dim-bars { display: flex; flex-direction: column; gap: 8px; align-self: center; }
.dim-row {
  display: grid;
  grid-template-columns: 140px 1fr 32px;
  gap: 12px;
  align-items: center;
  font-size: 13px;
}
.dim-name { color: var(--ink); font-weight: 500; }
.dim-bar {
  height: 8px;
  background: var(--surface-2);
  border-radius: 4px;
  overflow: hidden;
}
.dim-fill { height: 100%; transition: width 0.3s ease; }
.b-good { background: var(--good); }
.b-ok { background: var(--ok); }
.b-warn { background: var(--warn); }
.b-bad { background: var(--bad); }
.b-na { background: var(--na); }
.dim-score { text-align: right; font-variant-numeric: tabular-nums; font-weight: 500; }

.opportunities {
  margin: 24px 32px;
  padding: 20px 24px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 8px;
}
.opportunities h2 { margin: 0 0 4px; font-size: 14px; letter-spacing: 1px; text-transform: uppercase; color: var(--muted); }
.opportunities .sub { margin: 0 0 12px; color: var(--muted); font-size: 13px; }
.opportunities ol { margin: 0; padding-left: 24px; }
.opportunities li {
  padding: 6px 0;
  display: flex;
  gap: 14px;
  align-items: baseline;
  font-size: 13px;
}
.op-score { color: var(--muted); font-variant-numeric: tabular-nums; }
.op-impact { color: var(--good); font-weight: 500; margin-left: auto; }

main { padding: 0 32px 32px; }

.dim {
  margin-top: 32px;
}
.dim h2 {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: var(--muted);
  border-bottom: 1px solid var(--line);
  padding-bottom: 8px;
  margin: 0 0 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.dim-h-score { margin-left: auto; color: var(--ink); font-size: 16px; font-weight: 600; letter-spacing: 0; }

.probe {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 6px;
  margin-bottom: 8px;
  overflow: hidden;
}
.probe[open] { box-shadow: var(--shadow); }
.probe summary {
  list-style: none;
  cursor: pointer;
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  user-select: none;
}
.probe summary::-webkit-details-marker { display: none; }
.probe summary::before {
  content: "▸";
  color: var(--muted);
  font-size: 10px;
  width: 10px;
}
.probe[open] summary::before { content: "▾"; }
.p-verdict {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 3px;
  font-variant-numeric: tabular-nums;
  min-width: 40px;
  text-align: center;
}
.v-pass .p-verdict { background: var(--good-bg); color: var(--good-fg); }
.v-fail .p-verdict { background: var(--bad-bg); color: var(--bad-fg); }
.v-partial .p-verdict { background: var(--warn-bg); color: var(--partial-fg); }
.v-na .p-verdict { background: var(--surface-2); color: var(--muted); }
.v-err .p-verdict { background: var(--bad-bg); color: var(--bad-fg); }
.p-id { background: transparent; padding: 0; font-size: 13px; font-weight: 500; }
.p-body {
  padding: 4px 16px 16px;
  border-top: 1px solid var(--line);
  background: var(--surface-3);
}
.p-rationale p {
  margin: 12px 0;
  max-width: 70ch;
  color: var(--ink-soft);
}
.p-reading { margin: 12px 0; }
.p-remediation {
  margin: 12px 0;
  padding: 10px 14px;
  background: var(--remediation-bg);
  border-left: 3px solid var(--remediation-border);
  border-radius: 4px;
  font-size: 13px;
  max-width: 70ch;
}
.ladder {
  margin: 12px 0;
  padding: 12px 16px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 4px;
}
.ladder-h { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); margin-bottom: 8px; }
.ladder-sub { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
.rung {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 3px;
}
.rung.here { background: var(--here-bg); font-weight: 600; }
.here-mark { color: var(--here-fg); font-weight: 600; font-family: inherit; margin-left: 8px; font-size: 11px; }
.ladder.judge .crit-list { display: flex; flex-direction: column; gap: 6px; margin: 4px 0 12px; }
.crit-row {
  display: grid;
  grid-template-columns: 120px 1fr 36px;
  gap: 10px;
  align-items: center;
  font-size: 12px;
}
.crit-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--ink); }
.crit-bar {
  display: block;
  height: 6px;
  background: var(--surface-2);
  border-radius: 3px;
  overflow: hidden;
}
.crit-fill {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 0.3s ease;
}
.crit-val { text-align: right; font-variant-numeric: tabular-nums; font-weight: 500; }
.judge-rationale {
  margin: 8px 0 0;
  padding: 8px 12px;
  border-left: 3px solid var(--accent);
  background: var(--surface-2);
  color: var(--ink-soft);
  font-size: 13px;
  font-style: italic;
  white-space: pre-wrap;
}
.fixtures { margin-top: 12px; font-size: 12px; }
.fixtures summary { cursor: pointer; color: var(--muted); padding: 4px 0; }
.fixtures ul { margin: 4px 0 0; padding-left: 20px; }
.fixtures li { padding: 2px 0; }
.p-debug { margin-top: 12px; font-size: 12px; color: var(--muted); }

.baseline {
  margin: 32px;
  padding: 20px 24px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 8px;
}
.baseline h2 { margin: 0 0 12px; font-size: 14px; letter-spacing: 1px; text-transform: uppercase; color: var(--muted); }
.baseline .sub { color: var(--muted); }
.baseline table { width: 100%; border-collapse: collapse; font-size: 13px; }
.baseline th { text-align: left; font-weight: 500; padding: 6px 12px 6px 0; width: 200px; }
.baseline td { padding: 6px 12px 6px 0; font-variant-numeric: tabular-nums; }
.baseline td.arrow { color: var(--muted); width: 20px; padding: 0; }
.baseline td.delta-cell { color: var(--muted); width: 80px; }
.drift { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--line); font-size: 13px; color: var(--muted); }
.drift code { font-size: 12px; }

.ftr {
  padding: 16px 32px;
  border-top: 1px solid var(--line);
  font-size: 12px;
  color: var(--muted);
  display: flex;
  justify-content: space-between;
}
`;
