import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TIERS, type Tier, type ToolchainPhase, type ToolchainStack } from "../sdk/types.js";
import { errorMessage } from "../util/error-message.js";
import { isObject } from "../util/is-object.js";

export type GateMode = "ratchet" | "absolute" | "advisory";

export type CorpusPin = { package: string; version: string };

export type DimensionProbeOverride = {
  weight?: number;
  disabled?: boolean;
};

export type DimensionConfigOverride = {
  weight?: number;
  threshold?: number;
  gating?: boolean;
  gatingThreshold?: number;
  probes?: Record<string, DimensionProbeOverride>;
};

export type Waiver = {
  probeId: string;
  location: string;
  reason: string;
  expires?: string;
};

export type GateConfig = {
  mode: GateMode;
  absoluteThreshold?: number;
  /** Opt-in tiers (`executed`, `reasoned`) and opt-in probe ids to run beyond the defaults. */
  include?: string[];
};

export type CommandsOverride = Partial<Record<ToolchainPhase, string[]>>;

export type ToolchainConfig = {
  /** Force the primary stack instead of relying on detection. */
  primaryStack?: ToolchainStack;
  /** Per-phase argv overrides. Bypass detection entirely for that phase. */
  commands?: CommandsOverride;
};

export type ProjectConfig = {
  version: 1;
  corpus?: CorpusPin[];
  gate: GateConfig;
  toolchain?: ToolchainConfig;
  dimensions?: Record<string, DimensionConfigOverride>;
  probes?: Record<string, Record<string, unknown>>;
  waivers?: Waiver[];
  reporters?: ReportersConfig;
};

export type ReporterPlugin = {
  package: string;
  options?: Record<string, unknown>;
};

export type ReportersConfig = {
  default?: "human" | "json";
  plugins?: ReporterPlugin[];
};

export const CONFIG_FILENAME = "repofit.config.json";
export const CONFIG_SCHEMA_URL = "https://repofit.dev/schema/config.v1.json";

export const DEFAULT_CONFIG: ProjectConfig = {
  version: 1,
  gate: { mode: "advisory" },
};

const VALID_GATE_MODES: readonly GateMode[] = ["ratchet", "absolute", "advisory"];

export async function loadProjectConfig(cwd: string): Promise<ProjectConfig | null> {
  let raw: string;
  try {
    raw = await readFile(join(cwd, CONFIG_FILENAME), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`failed to parse ${CONFIG_FILENAME}: ${errorMessage(err)}`);
  }

  return validateConfig(parsed);
}

export async function writeProjectConfig(cwd: string, config: ProjectConfig): Promise<void> {
  const path = join(cwd, CONFIG_FILENAME);
  const withSchema = { $schema: CONFIG_SCHEMA_URL, ...config };
  await writeFile(path, `${JSON.stringify(withSchema, null, 2)}\n`, "utf8");
}

export function validateConfig(raw: unknown): ProjectConfig {
  if (!isObject(raw)) throw configError("/", "must be an object");

  if (raw.version !== 1)
    throw configError("/version", `must be 1, got ${JSON.stringify(raw.version)}`);

  const gate = validateGate(raw.gate, "/gate");
  const out: ProjectConfig = { version: 1, gate };

  if (raw.corpus !== undefined) out.corpus = validateCorpus(raw.corpus, "/corpus");
  if (raw.toolchain !== undefined) out.toolchain = validateToolchain(raw.toolchain, "/toolchain");
  if (raw.dimensions !== undefined)
    out.dimensions = validateDimensions(raw.dimensions, "/dimensions");
  if (raw.probes !== undefined) out.probes = validateProbeKnobs(raw.probes, "/probes");
  if (raw.waivers !== undefined) out.waivers = validateWaivers(raw.waivers, "/waivers");
  if (raw.reporters !== undefined) out.reporters = validateReporters(raw.reporters, "/reporters");

  return out;
}

function validateGate(raw: unknown, path: string): GateConfig {
  if (!isObject(raw)) throw configError(path, "must be an object");
  if (typeof raw.mode !== "string" || !VALID_GATE_MODES.includes(raw.mode as GateMode)) {
    throw configError(
      `${path}/mode`,
      `must be one of ${VALID_GATE_MODES.join(", ")}, got ${JSON.stringify(raw.mode)}`,
    );
  }
  const gate: GateConfig = { mode: raw.mode as GateMode };
  if (raw.absoluteThreshold !== undefined) {
    if (typeof raw.absoluteThreshold !== "number") {
      throw configError(`${path}/absoluteThreshold`, "must be a number");
    }
    gate.absoluteThreshold = raw.absoluteThreshold;
  }
  if (raw.include !== undefined) {
    if (!Array.isArray(raw.include)) throw configError(`${path}/include`, "must be an array");
    for (const [i, t] of raw.include.entries()) {
      if (typeof t !== "string" || !isIncludeToken(t)) {
        throw configError(
          `${path}/include/${i}`,
          `must be a tier (${TIERS.join(", ")}) or a probe id such as "agent.skill-evals-present", got ${JSON.stringify(t)}`,
        );
      }
    }
    gate.include = raw.include as string[];
  }
  return gate;
}

const PROBE_ID_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;

/** A `gate.include` entry: a tier name or a probe id (`family.name`). */
export function isIncludeToken(value: string): boolean {
  return TIERS.includes(value as Tier) || (value.includes(".") && PROBE_ID_RE.test(value));
}

/** Split `include` entries into the tiers and the probe ids they name. */
export function splitInclude(include: readonly string[]): {
  tiers: Set<Tier>;
  probeIds: Set<string>;
} {
  const tiers = new Set<Tier>();
  const probeIds = new Set<string>();
  for (const token of include) {
    if (TIERS.includes(token as Tier)) tiers.add(token as Tier);
    else probeIds.add(token);
  }
  return { tiers, probeIds };
}

function validateCorpus(raw: unknown, path: string): CorpusPin[] {
  if (!Array.isArray(raw)) throw configError(path, "must be an array");
  return raw.map((entry, i) => {
    const p = `${path}/${i}`;
    if (!isObject(entry)) throw configError(p, "must be an object");
    if (typeof entry.package !== "string" || entry.package.length === 0) {
      throw configError(`${p}/package`, "must be a non-empty string");
    }
    if (typeof entry.version !== "string" || entry.version.length === 0) {
      throw configError(`${p}/version`, "must be a non-empty string");
    }
    if (/[~^*x]/.test(entry.version)) {
      throw configError(`${p}/version`, "must be pinned (no semver ranges)");
    }
    return { package: entry.package, version: entry.version };
  });
}

const VALID_TOOLCHAIN_STACKS: readonly ToolchainStack[] = ["node", "python", "dotnet", "go"];
const VALID_TOOLCHAIN_PHASES: readonly ToolchainPhase[] = [
  "build",
  "test",
  "lint",
  "typecheck",
  "format",
];

function validateToolchain(raw: unknown, path: string): ToolchainConfig {
  if (!isObject(raw)) throw configError(path, "must be an object");
  const out: ToolchainConfig = {};
  if (raw.primaryStack !== undefined) {
    if (
      typeof raw.primaryStack !== "string" ||
      !VALID_TOOLCHAIN_STACKS.includes(raw.primaryStack as ToolchainStack)
    ) {
      throw configError(
        `${path}/primaryStack`,
        `must be one of ${VALID_TOOLCHAIN_STACKS.join(", ")}, got ${JSON.stringify(raw.primaryStack)}`,
      );
    }
    out.primaryStack = raw.primaryStack as ToolchainStack;
  }
  if (raw.commands !== undefined) {
    if (!isObject(raw.commands)) throw configError(`${path}/commands`, "must be an object");
    const commands: CommandsOverride = {};
    for (const [phase, value] of Object.entries(raw.commands)) {
      if (!VALID_TOOLCHAIN_PHASES.includes(phase as ToolchainPhase)) {
        throw configError(
          `${path}/commands/${phase}`,
          `unknown phase; expected one of ${VALID_TOOLCHAIN_PHASES.join(", ")}`,
        );
      }
      if (!Array.isArray(value) || value.length === 0) {
        throw configError(`${path}/commands/${phase}`, "must be a non-empty array of argv strings");
      }
      const argv: string[] = [];
      for (const [i, arg] of value.entries()) {
        if (typeof arg !== "string") {
          throw configError(`${path}/commands/${phase}/${i}`, "must be a string");
        }
        argv.push(arg);
      }
      commands[phase as ToolchainPhase] = argv;
    }
    out.commands = commands;
  }
  return out;
}

function validateDimensions(raw: unknown, path: string): Record<string, DimensionConfigOverride> {
  if (!isObject(raw)) throw configError(path, "must be an object");
  const out: Record<string, DimensionConfigOverride> = {};
  for (const [id, value] of Object.entries(raw)) {
    out[id] = validateDimensionOverride(value, `${path}/${id}`);
  }
  return out;
}

function validateDimensionOverride(raw: unknown, path: string): DimensionConfigOverride {
  if (!isObject(raw)) throw configError(path, "must be an object");
  const out: DimensionConfigOverride = {};
  if (raw.weight !== undefined) {
    if (typeof raw.weight !== "number") throw configError(`${path}/weight`, "must be a number");
    out.weight = raw.weight;
  }
  if (raw.threshold !== undefined) {
    if (typeof raw.threshold !== "number")
      throw configError(`${path}/threshold`, "must be a number");
    out.threshold = raw.threshold;
  }
  if (raw.gating !== undefined) {
    if (typeof raw.gating !== "boolean") throw configError(`${path}/gating`, "must be a boolean");
    out.gating = raw.gating;
  }
  if (raw.gatingThreshold !== undefined) {
    if (typeof raw.gatingThreshold !== "number")
      throw configError(`${path}/gatingThreshold`, "must be a number");
    out.gatingThreshold = raw.gatingThreshold;
  }
  if (raw.probes !== undefined) {
    if (!isObject(raw.probes)) throw configError(`${path}/probes`, "must be an object");
    const probes: Record<string, DimensionProbeOverride> = {};
    for (const [pid, pvalue] of Object.entries(raw.probes)) {
      probes[pid] = validateDimensionProbeOverride(pvalue, `${path}/probes/${pid}`);
    }
    out.probes = probes;
  }
  return out;
}

function validateDimensionProbeOverride(raw: unknown, path: string): DimensionProbeOverride {
  if (!isObject(raw)) throw configError(path, "must be an object");
  const out: DimensionProbeOverride = {};
  if (raw.weight !== undefined) {
    if (typeof raw.weight !== "number") throw configError(`${path}/weight`, "must be a number");
    out.weight = raw.weight;
  }
  if (raw.disabled !== undefined) {
    if (typeof raw.disabled !== "boolean")
      throw configError(`${path}/disabled`, "must be a boolean");
    out.disabled = raw.disabled;
  }
  return out;
}

function validateProbeKnobs(raw: unknown, path: string): Record<string, Record<string, unknown>> {
  if (!isObject(raw)) throw configError(path, "must be an object");
  const out: Record<string, Record<string, unknown>> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!isObject(value)) throw configError(`${path}/${id}`, "must be an object");
    out[id] = value;
  }
  return out;
}

function validateWaivers(raw: unknown, path: string): Waiver[] {
  if (!Array.isArray(raw)) throw configError(path, "must be an array");
  return raw.map((entry, i) => {
    const p = `${path}/${i}`;
    if (!isObject(entry)) throw configError(p, "must be an object");
    if (typeof entry.probeId !== "string" || entry.probeId.length === 0) {
      throw configError(`${p}/probeId`, "must be a non-empty string");
    }
    if (typeof entry.location !== "string" || entry.location.length === 0) {
      throw configError(`${p}/location`, "must be a non-empty string");
    }
    if (typeof entry.reason !== "string" || entry.reason.trim().length === 0) {
      throw configError(`${p}/reason`, "must be a non-empty string");
    }
    const out: Waiver = {
      probeId: entry.probeId,
      location: entry.location,
      reason: entry.reason,
    };
    if (entry.expires !== undefined) {
      if (typeof entry.expires !== "string" || !isIsoDate(entry.expires)) {
        throw configError(`${p}/expires`, "must be an ISO 8601 date (YYYY-MM-DD)");
      }
      out.expires = entry.expires;
    }
    return out;
  });
}

function validateReporters(raw: unknown, path: string): ReportersConfig {
  if (!isObject(raw)) throw configError(path, "must be an object");
  const out: ReportersConfig = {};
  if (raw.default !== undefined) {
    if (raw.default !== "human" && raw.default !== "json") {
      throw configError(`${path}/default`, "must be 'human' or 'json'");
    }
    out.default = raw.default;
  }
  if (raw.plugins !== undefined) {
    if (!Array.isArray(raw.plugins)) throw configError(`${path}/plugins`, "must be an array");
    out.plugins = raw.plugins.map((entry, i) => {
      const p = `${path}/plugins/${i}`;
      if (!isObject(entry)) throw configError(p, "must be an object");
      if (typeof entry.package !== "string" || entry.package.length === 0) {
        throw configError(`${p}/package`, "must be a non-empty string");
      }
      const plugin: ReporterPlugin = { package: entry.package };
      if (entry.options !== undefined) {
        if (!isObject(entry.options)) throw configError(`${p}/options`, "must be an object");
        plugin.options = entry.options as Record<string, unknown>;
      }
      return plugin;
    });
  }
  return out;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/.test(value);
}

function configError(path: string, message: string): Error {
  return new Error(`${CONFIG_FILENAME}: ${path} ${message}`);
}
