import type { DimensionRecipe, Fixer, Probe } from "../sdk/types.js";
import { errorMessage } from "../util/error-message.js";

export type CorpusOverride = {
  kind: "probe" | "dimension" | "fixer";
  id: string;
  from: string;
  to: string;
};

export type LoadedCorpus = {
  name: string;
  version: string;
  probes: Probe[];
  dimensions: DimensionRecipe[];
  fixers: Fixer[];
  sources: { package: string; version: string }[];
  overrides: CorpusOverride[];
};

export type CorpusModule = {
  meta?: { name?: string; version?: string };
  probes?: Probe[];
  dimensions?: DimensionRecipe[];
  fixers?: Fixer[];
};

const DEFAULT_CORPUS_PACKAGE = "@esbenwiberg/corpus-default";

export type LoadCorporaOptions = {
  packages?: string[];
};

export async function loadCorpora(opts: LoadCorporaOptions = {}): Promise<LoadedCorpus> {
  const packages =
    opts.packages && opts.packages.length > 0 ? opts.packages : [DEFAULT_CORPUS_PACKAGE];

  const loaded: { pkg: string; mod: CorpusModule }[] = [];
  for (const pkg of packages) {
    let mod: CorpusModule;
    try {
      mod = (await import(pkg)) as CorpusModule;
    } catch (err) {
      throw new Error(`failed to load corpus '${pkg}': ${errorMessage(err)}`);
    }
    if (!Array.isArray(mod.probes) || mod.probes.length === 0) {
      throw new Error(`corpus '${pkg}' exports no probes`);
    }
    if (!Array.isArray(mod.dimensions) || mod.dimensions.length === 0) {
      throw new Error(`corpus '${pkg}' exports no dimensions`);
    }
    loaded.push({ pkg, mod });
  }

  return mergeCorpora(loaded);
}

export function mergeCorpora(loaded: { pkg: string; mod: CorpusModule }[]): LoadedCorpus {
  const probesById = new Map<string, { probe: Probe; from: string }>();
  const dimsById = new Map<string, { dim: DimensionRecipe; from: string }>();
  const fixersByKey = new Map<string, { fixer: Fixer; from: string }>();
  const overrides: CorpusOverride[] = [];

  for (const { pkg, mod } of loaded) {
    for (const probe of mod.probes ?? []) {
      const existing = probesById.get(probe.id);
      if (existing) {
        overrides.push({ kind: "probe", id: probe.id, from: existing.from, to: pkg });
      }
      probesById.set(probe.id, { probe, from: pkg });
    }
    for (const dim of mod.dimensions ?? []) {
      const existing = dimsById.get(dim.id);
      if (existing) {
        overrides.push({ kind: "dimension", id: dim.id, from: existing.from, to: pkg });
      }
      dimsById.set(dim.id, { dim, from: pkg });
    }
    for (const fixer of mod.fixers ?? []) {
      const key = fixerKey(fixer);
      const existing = fixersByKey.get(key);
      if (existing) {
        overrides.push({ kind: "fixer", id: key, from: existing.from, to: pkg });
      }
      fixersByKey.set(key, { fixer, from: pkg });
    }
  }

  const primary = loaded[0];
  return {
    name: primary?.mod.meta?.name ?? primary?.pkg ?? DEFAULT_CORPUS_PACKAGE,
    version: primary?.mod.meta?.version ?? "0.0.0",
    probes: [...probesById.values()].map((e) => e.probe),
    dimensions: [...dimsById.values()].map((e) => e.dim),
    fixers: [...fixersByKey.values()].map((e) => e.fixer),
    sources: loaded.map(({ pkg, mod }) => ({
      package: pkg,
      version: mod.meta?.version ?? "0.0.0",
    })),
    overrides,
  };
}

function fixerKey(fixer: Fixer): string {
  return `${fixer.probeId}:${fixer.mode}`;
}
