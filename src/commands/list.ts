import { activeEntries, loadCatalog, type CatalogEntry } from "../catalog.js";

export interface ListOptions {
  showDeprecated: boolean;
}

export function runList(options: ListOptions): number {
  const { entries, malformed } = loadCatalog();

  const visible = options.showDeprecated ? entries : activeEntries(entries);

  if (visible.length === 0 && malformed.length === 0) {
    console.log("No catalog entries found.");
    return 0;
  }

  if (visible.length > 0) {
    const idWidth = Math.max(...visible.map((e) => e.id.length), 2);
    const nameWidth = Math.max(...visible.map((e) => e.name.length), 4);

    console.log(
      `${"ID".padEnd(idWidth)}  ${"NAME".padEnd(nameWidth)}  DESCRIPTION`,
    );
    console.log(
      `${"-".repeat(idWidth)}  ${"-".repeat(nameWidth)}  ${"-".repeat(11)}`,
    );

    const sorted = [...visible].sort((a, b) => a.id.localeCompare(b.id));
    for (const e of sorted) {
      const dep = e.deprecated_by ? ` (deprecated → ${e.deprecated_by})` : "";
      console.log(
        `${e.id.padEnd(idWidth)}  ${e.name.padEnd(nameWidth)}  ${e.description}${dep}`,
      );
    }

    console.log("");
    console.log(
      `${visible.length} entr${visible.length === 1 ? "y" : "ies"}.`,
    );
  }

  if (malformed.length > 0) {
    console.warn("");
    console.warn(
      `${malformed.length} malformed entr${malformed.length === 1 ? "y" : "ies"} skipped:`,
    );
    for (const m of malformed) {
      const tag = m.id ?? "(unparsed)";
      console.warn(`  - ${tag} [${m.sourceFile}]`);
      for (const err of m.errors) {
        console.warn(`      • ${err}`);
      }
    }
    return 1;
  }

  return 0;
}

export function _printForTest(entries: CatalogEntry[]): void {
  for (const e of entries) console.log(e.id);
}
