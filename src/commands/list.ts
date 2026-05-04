import { activeEntries } from "../catalog.js";
import { loadMergedCatalog } from "../merged-catalog.js";
import {
  printMalformedEntries,
  printOverlayLoadErrors,
} from "../warnings.js";

export interface ListOptions {
  cwd: string;
  showDeprecated: boolean;
}

export function runList(options: ListOptions): number {
  const { entries, malformed, overlayLoadErrors } = loadMergedCatalog(options.cwd);

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
      const tag = e.overlay ? ` [overlay:${e.overlay}]` : "";
      console.log(
        `${e.id.padEnd(idWidth)}  ${e.name.padEnd(nameWidth)}  ${e.description}${dep}${tag}`,
      );
    }

    console.log("");
    console.log(
      `${visible.length} entr${visible.length === 1 ? "y" : "ies"}.`,
    );
  }

  printOverlayLoadErrors(overlayLoadErrors);
  printMalformedEntries(malformed);

  return malformed.length > 0 ? 1 : 0;
}
