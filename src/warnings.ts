import type { MalformedEntry } from "./catalog.js";
import type { MalformedOverlay } from "./overlays.js";

export function printOverlayLoadErrors(errors: MalformedOverlay[]): void {
  if (errors.length === 0) return;
  console.warn("");
  console.warn(
    `${errors.length} overlay registration${errors.length === 1 ? "" : "s"} failed:`,
  );
  for (const e of errors) {
    const tag = e.registrationId ?? "(unparsed)";
    console.warn(`  - ${tag}`);
    for (const err of e.errors) console.warn(`      • ${err}`);
  }
}

export function printMalformedEntries(malformed: MalformedEntry[]): void {
  if (malformed.length === 0) return;
  console.warn("");
  console.warn(
    `${malformed.length} malformed catalog entr${malformed.length === 1 ? "y" : "ies"} skipped:`,
  );
  for (const m of malformed) {
    const tag = m.id ?? "(unparsed)";
    const overlayTag = m.overlay ? ` (overlay:${m.overlay})` : "";
    console.warn(`  - ${tag}${overlayTag} [${m.sourceFile}]`);
    for (const err of m.errors) console.warn(`      • ${err}`);
  }
}
