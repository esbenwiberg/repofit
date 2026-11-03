import type { Waiver } from "../loader/config.js";
import { score } from "../scorer/index.js";
import { type EvidenceMap, type Probe, type Reading, TIERS, type Tier } from "../sdk/types.js";
import { errorMessage } from "../util/error-message.js";
import { startTimer } from "../util/timing.js";

export type ProbeResult = {
  probe: Probe;
  reading: Reading;
  score: number | null;
  durationMs?: number;
};

export type RunOptions = {
  waivers?: Waiver[];
  includeTiers?: ReadonlySet<Tier>;
  /** Ids of opt-in probes to run; an opt-in probe not listed here is skipped. */
  includeProbes?: ReadonlySet<string>;
};

export type RunSummary = {
  results: ProbeResult[];
  tierWallClockMs: Record<Tier, number>;
};

export const DEFAULT_TIERS: ReadonlySet<Tier> = new Set(
  TIERS.filter((t) => t !== "executed" && t !== "reasoned"),
);

export async function runProbes(
  probes: Probe[],
  evidence: EvidenceMap,
  opts: RunOptions = {},
): Promise<ProbeResult[]> {
  return (await runProbesDetailed(probes, evidence, opts)).results;
}

export async function runProbesDetailed(
  probes: Probe[],
  evidence: EvidenceMap,
  opts: RunOptions = {},
): Promise<RunSummary> {
  const waiversByProbe = groupWaivers(opts.waivers ?? []);
  const include = opts.includeTiers ?? DEFAULT_TIERS;
  const includeProbes = opts.includeProbes ?? new Set<string>();
  const eligible = probes.filter(
    (p) => include.has(p.tier) && (!p.optIn || includeProbes.has(p.id)),
  );
  const buckets = groupByTier(eligible);
  const results: ProbeResult[] = [];
  const tierWallClockMs = emptyTierMap();
  for (const tier of TIERS) {
    const bucket = buckets.get(tier);
    if (!bucket || bucket.length === 0) continue;
    const elapsed = startTimer();
    const tierResults =
      tier === "executed"
        ? await runSerial(bucket, evidence, waiversByProbe)
        : await Promise.all(bucket.map((p) => runOne(p, evidence, waiversByProbe.get(p.id) ?? [])));
    tierWallClockMs[tier] = elapsed();
    results.push(...tierResults);
  }
  return { results, tierWallClockMs };
}

async function runSerial(
  probes: Probe[],
  evidence: EvidenceMap,
  waiversByProbe: Map<string, Waiver[]>,
): Promise<ProbeResult[]> {
  const out: ProbeResult[] = [];
  for (const probe of probes) {
    out.push(await runOne(probe, evidence, waiversByProbe.get(probe.id) ?? []));
  }
  return out;
}

function emptyTierMap(): Record<Tier, number> {
  const out = {} as Record<Tier, number>;
  for (const t of TIERS) out[t] = 0;
  return out;
}

function groupByTier(probes: Probe[]): Map<Tier, Probe[]> {
  const buckets = new Map<Tier, Probe[]>();
  for (const probe of probes) {
    const bucket = buckets.get(probe.tier);
    if (bucket) bucket.push(probe);
    else buckets.set(probe.tier, [probe]);
  }
  return buckets;
}

function groupWaivers(waivers: Waiver[]): Map<string, Waiver[]> {
  const out = new Map<string, Waiver[]>();
  for (const w of waivers) {
    const bucket = out.get(w.probeId);
    if (bucket) bucket.push(w);
    else out.set(w.probeId, [w]);
  }
  return out;
}

async function runOne(
  probe: Probe,
  evidence: EvidenceMap,
  waivers: Waiver[],
): Promise<ProbeResult> {
  const elapsed = startTimer();
  let reading: Reading;
  try {
    reading = await probe.detect(evidence);
  } catch (err) {
    return {
      probe,
      reading: { kind: "error", error: errorMessage(err) },
      score: null,
      durationMs: elapsed(),
    };
  }

  const filtered = applyWaivers(reading, waivers);

  try {
    const result = score(filtered, probe.score);
    return { probe, reading: filtered, score: result, durationMs: elapsed() };
  } catch (err) {
    return {
      probe,
      reading: { kind: "error", error: `scoring failed: ${errorMessage(err)}` },
      score: null,
      durationMs: elapsed(),
    };
  }
}

function applyWaivers(reading: Reading, waivers: Waiver[]): Reading {
  if (waivers.length === 0) return reading;
  if (reading.kind === "inventory") {
    const items = reading.items.filter(
      (item) => !waivers.some((w) => matchesWaiver(w, item.location.path)),
    );
    if (items.length === reading.items.length) return reading;
    return { kind: "inventory", items };
  }
  if (reading.kind === "count") {
    const samples = reading.samples ?? [];
    if (samples.length === 0) return reading;
    const kept = samples.filter((loc) => !waivers.some((w) => matchesWaiver(w, loc.path)));
    if (kept.length === samples.length) return reading;
    const drop = samples.length - kept.length;
    return {
      kind: "count",
      value: Math.max(0, reading.value - drop),
      samples: kept,
    };
  }
  return reading;
}

function matchesWaiver(waiver: Waiver, path: string): boolean {
  const [waivedPath] = waiver.location.split(":", 1);
  return waivedPath === path;
}
