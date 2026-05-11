import type { Waiver } from "../loader/config.js";
import { score } from "../scorer/index.js";
import type { EvidenceMap, Probe, Reading, Tier } from "../sdk/types.js";
import { errorMessage } from "../util/error-message.js";

export type ProbeResult = {
  probe: Probe;
  reading: Reading;
  score: number | null;
  durationMs?: number;
};

export type RunOptions = {
  waivers?: Waiver[];
  includeTiers?: ReadonlySet<Tier>;
};

export type RunSummary = {
  results: ProbeResult[];
  tierWallClockMs: Record<Tier, number>;
};

const TIER_ORDER: Tier[] = ["static", "derived", "historical", "executed", "reasoned"];
export const DEFAULT_TIERS: ReadonlySet<Tier> = new Set(["static", "derived", "historical"]);

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
  const eligible = probes.filter((p) => include.has(p.tier));
  const buckets = groupByTier(eligible);
  const results: ProbeResult[] = [];
  const tierWallClockMs = emptyTierMap();
  for (const tier of TIER_ORDER) {
    const bucket = buckets.get(tier);
    if (!bucket || bucket.length === 0) continue;
    const tierStart = process.hrtime.bigint();
    const tierResults = await Promise.all(
      bucket.map((p) => runOne(p, evidence, waiversByProbe.get(p.id) ?? [])),
    );
    tierWallClockMs[tier] = Number((process.hrtime.bigint() - tierStart) / 1_000_000n);
    results.push(...tierResults);
  }
  return { results, tierWallClockMs };
}

function emptyTierMap(): Record<Tier, number> {
  return { static: 0, derived: 0, historical: 0, executed: 0, reasoned: 0 };
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
  const start = process.hrtime.bigint();
  let reading: Reading;
  try {
    reading = await probe.detect(evidence);
  } catch (err) {
    const durationMs = Number((process.hrtime.bigint() - start) / 1_000_000n);
    return {
      probe,
      reading: { kind: "error", error: errorMessage(err) },
      score: null,
      durationMs,
    };
  }

  const filtered = applyWaivers(reading, waivers);

  try {
    const result = score(filtered, probe.score);
    const durationMs = Number((process.hrtime.bigint() - start) / 1_000_000n);
    return { probe, reading: filtered, score: result, durationMs };
  } catch (err) {
    const durationMs = Number((process.hrtime.bigint() - start) / 1_000_000n);
    return {
      probe,
      reading: { kind: "error", error: `scoring failed: ${errorMessage(err)}` },
      score: null,
      durationMs,
    };
  }
}

function applyWaivers(reading: Reading, waivers: Waiver[]): Reading {
  if (reading.kind !== "inventory" || waivers.length === 0) return reading;
  const items = reading.items.filter(
    (item) => !waivers.some((w) => matchesWaiver(w, item.location.path)),
  );
  if (items.length === reading.items.length) return reading;
  return { kind: "inventory", items };
}

function matchesWaiver(waiver: Waiver, path: string): boolean {
  const [waivedPath] = waiver.location.split(":", 1);
  return waivedPath === path;
}
