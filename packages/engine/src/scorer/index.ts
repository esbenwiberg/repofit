import type { Band, InventoryItem, Reading, ScoreConfig, Severity } from "../sdk/types.js";

export function score(reading: Reading, config: ScoreConfig): number | null {
  if (reading.kind === "na" || reading.kind === "error") return null;

  switch (config.kind) {
    case "predicate": {
      if (reading.kind !== "predicate") throw mismatch(reading, config);
      const truth = reading.value ? 100 : 0;
      return config.direction === "positive" ? truth : 100 - truth;
    }
    case "count": {
      if (reading.kind !== "count") throw mismatch(reading, config);
      return scoreBands(reading.value, config.bands);
    }
    case "magnitude": {
      if (reading.kind !== "magnitude") throw mismatch(reading, config);
      return scoreBands(reading.value, config.bands);
    }
    case "inventory": {
      if (reading.kind !== "inventory") throw mismatch(reading, config);
      return scoreBands(sumSeverityWeights(reading.items, config.severityWeights), config.bands);
    }
    case "distribution": {
      if (reading.kind !== "distribution") throw mismatch(reading, config);
      if (reading.samples.length === 0) {
        throw new Error("distribution scorer: empty samples (detector should emit `na` instead)");
      }
      return scoreBands(distributionStat(reading.samples, config.stat), config.bands);
    }
    case "judge": {
      if (reading.kind !== "judge") throw mismatch(reading, config);
      return reading.score;
    }
  }
}

function mismatch(reading: Reading, config: ScoreConfig): Error {
  return new Error(`scorer mismatch: reading.kind=${reading.kind} but score.kind=${config.kind}`);
}

function scoreBands(value: number, bands: Band[]): number {
  for (const band of bands) {
    if (band.upTo === undefined) return band.score;
    if (value <= band.upTo) return band.score;
  }
  throw new Error("bands exhausted without a fallback band (last band must omit `upTo`)");
}

function sumSeverityWeights(items: InventoryItem[], weights: Record<Severity, number>): number {
  let total = 0;
  for (const item of items) total += weights[item.severity] ?? 0;
  return total;
}

function distributionStat(
  samples: number[],
  stat: "mean" | "median" | "p95" | "p99" | "max",
): number {
  if (stat === "mean") {
    let sum = 0;
    for (const v of samples) sum += v;
    return sum / samples.length;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  if (stat === "max") return sorted[sorted.length - 1] as number;
  const p = stat === "median" ? 0.5 : stat === "p95" ? 0.95 : 0.99;
  return percentile(sorted, p);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0] as number;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo] as number;
  const w = idx - lo;
  return (sorted[lo] as number) * (1 - w) + (sorted[hi] as number) * w;
}
