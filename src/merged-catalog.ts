import { resolve } from "node:path";
import {
  loadCatalogSource,
  validateCrossReferences,
  type CatalogEntry,
  type CatalogLoadResult,
  type MalformedEntry,
} from "./catalog.js";
import {
  loadOverlays,
  type MalformedOverlay,
  type ParsedOverlay,
} from "./overlays.js";
import { CATALOG_DIR, CONTENT_DIR } from "./paths.js";

export interface MergedCatalogResult {
  entries: CatalogEntry[];
  malformed: MalformedEntry[];
  shadowed: CatalogEntry[];
  overlayLoadErrors: MalformedOverlay[];
  registeredOverlays: ParsedOverlay[];
}

export function loadMergedCatalog(repoRoot: string): MergedCatalogResult {
  const sources: CatalogLoadResult[] = [];

  sources.push(
    loadCatalogSource({ catalogDir: CATALOG_DIR, sourceRoot: CONTENT_DIR }),
  );

  const { overlays, malformed: overlayLoadErrors } = loadOverlays(repoRoot);
  for (const overlay of overlays) {
    sources.push(
      loadCatalogSource({
        catalogDir: resolve(overlay.rootDir, "catalog"),
        sourceRoot: overlay.rootDir,
        overlayId: overlay.registrationId,
      }),
    );
  }

  const byId = new Map<string, CatalogEntry>();
  const shadowed: CatalogEntry[] = [];
  const priorMalformed: MalformedEntry[] = [];

  for (const src of sources) {
    for (const entry of src.entries) {
      const prior = byId.get(entry.id);
      if (prior) shadowed.push(prior);
      byId.set(entry.id, entry);
    }
    for (const m of src.malformed) priorMalformed.push(m);
  }

  const validated = validateCrossReferences(
    [...byId.values()],
    priorMalformed,
  );

  return {
    ...validated,
    shadowed,
    overlayLoadErrors,
    registeredOverlays: overlays,
  };
}
