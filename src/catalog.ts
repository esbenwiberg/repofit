import { readdirSync, readFileSync, existsSync } from "node:fs";
import { basename, extname, resolve, isAbsolute, normalize } from "node:path";
import { parse as parseToml } from "smol-toml";
import { CATALOG_DIR, CONTENT_DIR } from "./paths.js";
import { isString, isStringArray } from "./typeguards.js";

export type Flavor = "claude" | "agnostic";
export type Conflict = "prompt" | "overwrite" | "skip-if-exists";
export type Layer =
  | "context"
  | "conventions"
  | "specs"
  | "harness"
  | "execution"
  | "validation"
  | "architecture";

export interface Provide {
  source: string;
  target: string;
  flavor: Flavor;
  conflict: Conflict;
}

export interface Detect {
  any_of: string[];
}

export interface Requires {
  git: boolean;
  entries: string[];
  tools: string[];
}

export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  layers: Layer[];
  provides: Provide[];
  detect: Detect;
  requires: Requires;
  deprecated_by?: string;
  sourceFile: string;
}

export interface MalformedEntry {
  sourceFile: string;
  id?: string;
  errors: string[];
}

export interface CatalogLoadResult {
  entries: CatalogEntry[];
  malformed: MalformedEntry[];
}

const VALID_LAYERS: ReadonlySet<Layer> = new Set<Layer>([
  "context",
  "conventions",
  "specs",
  "harness",
  "execution",
  "validation",
  "architecture",
]);

const VALID_FLAVORS: ReadonlySet<Flavor> = new Set<Flavor>([
  "claude",
  "agnostic",
]);

const VALID_CONFLICTS: ReadonlySet<Conflict> = new Set<Conflict>([
  "prompt",
  "overwrite",
  "skip-if-exists",
]);

const ID_RE = /^[a-z][a-z0-9-]*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function isRepoRelative(p: string): boolean {
  if (!isString(p)) return false;
  if (p === "") return false;
  if (isAbsolute(p)) return false;
  if (p.startsWith("/")) return false;
  const norm = normalize(p);
  if (norm.startsWith("..")) return false;
  if (norm.split(/[\\/]/).includes("..")) return false;
  return true;
}

export function activeEntries(entries: CatalogEntry[]): CatalogEntry[] {
  return entries.filter((e) => !e.deprecated_by);
}

export function loadCatalog(): CatalogLoadResult {
  const entries: CatalogEntry[] = [];
  const malformed: MalformedEntry[] = [];

  if (!existsSync(CATALOG_DIR)) {
    return { entries, malformed };
  }

  const files = readdirSync(CATALOG_DIR)
    .filter((f) => f.endsWith(".toml"))
    .sort();

  for (const file of files) {
    const filePath = resolve(CATALOG_DIR, file);
    const stem = basename(file, extname(file));
    const result = parseEntry(filePath, stem);
    if ("errors" in result) {
      malformed.push(result);
    } else {
      entries.push(result);
    }
  }

  validateCrossReferences(entries, malformed);
  return { entries, malformed };
}

function parseEntry(
  filePath: string,
  stem: string,
): CatalogEntry | MalformedEntry {
  const errors: string[] = [];
  let raw: Record<string, unknown>;
  try {
    raw = parseToml(readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch (err) {
    return {
      sourceFile: filePath,
      errors: [`failed to parse TOML: ${(err as Error).message}`],
    };
  }

  const id = raw.id;
  if (!isString(id) || !ID_RE.test(id)) {
    errors.push(`id must match /^[a-z][a-z0-9-]*$/ (got ${JSON.stringify(id)})`);
  } else if (id !== stem) {
    errors.push(`id "${id}" does not match filename stem "${stem}"`);
  }

  if (!isString(raw.name)) errors.push(`name must be a string`);
  if (!isString(raw.description)) errors.push(`description must be a string`);
  if (!isString(raw.version) || !SEMVER_RE.test(raw.version as string)) {
    errors.push(`version must be valid semver (got ${JSON.stringify(raw.version)})`);
  }

  const layers: Layer[] = [];
  if (raw.layers !== undefined) {
    if (!isStringArray(raw.layers)) {
      errors.push(`layers must be an array of strings`);
    } else {
      for (const l of raw.layers) {
        if (!VALID_LAYERS.has(l as Layer)) {
          errors.push(`unknown layer "${l}"`);
        } else {
          layers.push(l as Layer);
        }
      }
    }
  }

  const providesRaw = raw.provides;
  const provides: Provide[] = [];
  if (!Array.isArray(providesRaw) || providesRaw.length === 0) {
    errors.push(`[[provides]] must have at least one entry`);
  } else {
    const seenTargets = new Set<string>();
    for (let i = 0; i < providesRaw.length; i++) {
      const p = providesRaw[i] as Record<string, unknown>;
      const prefix = `provides[${i}]`;
      const source = p?.source;
      const target = p?.target;
      const flavor = p?.flavor;
      const conflict = p?.conflict;

      if (!isString(source) || !isRepoRelative(source)) {
        errors.push(`${prefix}.source must be a repo-relative path`);
      } else if (!existsSync(resolve(CONTENT_DIR, source))) {
        errors.push(`${prefix}.source not found: content/${source}`);
      }

      if (!isString(target) || !isRepoRelative(target)) {
        errors.push(`${prefix}.target must be a repo-relative path`);
      } else if (seenTargets.has(target)) {
        errors.push(`${prefix}.target duplicated within entry: ${target}`);
      } else {
        seenTargets.add(target);
      }

      if (!isString(flavor) || !VALID_FLAVORS.has(flavor as Flavor)) {
        errors.push(`${prefix}.flavor must be claude|agnostic`);
      }

      if (!isString(conflict) || !VALID_CONFLICTS.has(conflict as Conflict)) {
        errors.push(`${prefix}.conflict must be prompt|overwrite|skip-if-exists`);
      }

      if (
        isString(source) &&
        isString(target) &&
        isString(flavor) &&
        isString(conflict) &&
        VALID_FLAVORS.has(flavor as Flavor) &&
        VALID_CONFLICTS.has(conflict as Conflict)
      ) {
        provides.push({
          source,
          target,
          flavor: flavor as Flavor,
          conflict: conflict as Conflict,
        });
      }
    }
  }

  const detectRaw = raw.detect as Record<string, unknown> | undefined;
  let detect: Detect = { any_of: [] };
  if (!detectRaw) {
    errors.push(`[detect] table is required`);
  } else {
    const anyOf = detectRaw.any_of;
    if (!isStringArray(anyOf) || anyOf.length === 0) {
      errors.push(`detect.any_of must be a non-empty string array`);
    } else {
      for (const p of anyOf) {
        if (!isRepoRelative(p)) {
          errors.push(`detect.any_of contains non-repo-relative path: ${p}`);
        }
      }
      detect = { any_of: anyOf };
    }
  }

  const requiresRaw = (raw.requires as Record<string, unknown> | undefined) ?? {};
  const requires: Requires = {
    git: requiresRaw.git === true,
    entries: isStringArray(requiresRaw.entries) ? requiresRaw.entries : [],
    tools: isStringArray(requiresRaw.tools) ? requiresRaw.tools : [],
  };
  if (requiresRaw.git !== undefined && typeof requiresRaw.git !== "boolean") {
    errors.push(`requires.git must be boolean`);
  }
  if (requiresRaw.entries !== undefined && !isStringArray(requiresRaw.entries)) {
    errors.push(`requires.entries must be a string array`);
  }
  if (requiresRaw.tools !== undefined && !isStringArray(requiresRaw.tools)) {
    errors.push(`requires.tools must be a string array`);
  }

  const deprecated_by =
    isString(raw.deprecated_by) && raw.deprecated_by.length > 0
      ? raw.deprecated_by
      : undefined;

  if (errors.length > 0) {
    return {
      sourceFile: filePath,
      ...(isString(id) ? { id } : {}),
      errors,
    };
  }

  const entry: CatalogEntry = {
    id: id as string,
    name: raw.name as string,
    description: raw.description as string,
    version: raw.version as string,
    layers,
    provides,
    detect,
    requires,
    sourceFile: filePath,
    ...(deprecated_by ? { deprecated_by } : {}),
  };
  return entry;
}

function validateCrossReferences(
  entries: CatalogEntry[],
  malformed: MalformedEntry[],
): void {
  const ids = new Set(entries.map((e) => e.id));
  const stillValid: CatalogEntry[] = [];
  for (const entry of entries) {
    const errors: string[] = [];
    for (const dep of entry.requires.entries) {
      if (!ids.has(dep)) {
        errors.push(`requires.entries references unknown id "${dep}"`);
      }
    }
    if (entry.deprecated_by && !ids.has(entry.deprecated_by)) {
      errors.push(`deprecated_by references unknown id "${entry.deprecated_by}"`);
    }
    if (errors.length > 0) {
      malformed.push({
        sourceFile: entry.sourceFile,
        id: entry.id,
        errors,
      });
    } else {
      stillValid.push(entry);
    }
  }
  entries.length = 0;
  entries.push(...stillValid);
}
