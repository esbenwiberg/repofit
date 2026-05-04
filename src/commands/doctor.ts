import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  activeEntries,
  loadCatalog,
  type CatalogEntry,
  type Layer,
} from "../catalog.js";
import { CONTENT_DIR } from "../paths.js";
import { isToolAvailable } from "../io.js";
import { classifyProvideDrift, type DriftKind } from "../drift.js";
import {
  findLockedEntry,
  readLockfile,
  type Lockfile,
} from "../lockfile.js";

export interface DoctorOptions {
  cwd: string;
}

type Status = "installed" | "missing" | "partial";
type ReportedDriftKind = Exclude<DriftKind, "missing">;

interface ProvideDrift {
  target: string;
  kind: ReportedDriftKind;
}

interface VersionDrift {
  installed: string;
  current: string;
}

interface Report {
  entry: CatalogEntry;
  status: Status;
  detected: string[];
  providedPresent: string[];
  providedMissing: string[];
  drift: ProvideDrift[];
  missingTools: string[];
  versionDrift: VersionDrift | null;
}

const LAYER_ORDER: Layer[] = [
  "context",
  "conventions",
  "specs",
  "harness",
  "execution",
  "validation",
  "architecture",
];

const STATUS_GLYPH: Record<Status, string> = {
  installed: "✓",
  partial: "~",
  missing: "·",
};

export async function runDoctor(options: DoctorOptions): Promise<number> {
  const { entries, malformed } = loadCatalog();

  if (entries.length === 0 && malformed.length === 0) {
    console.log("No catalog entries to audit.");
    return 0;
  }

  const lockfile = await readLockfile(options.cwd);

  const reports = await Promise.all(
    activeEntries(entries).map((entry) =>
      buildReport(entry, options.cwd, lockfile),
    ),
  );

  console.log(`agentry doctor — auditing ${options.cwd}`);
  if (lockfile === null) {
    console.log("(no agentry.lock.toml — drift kind will be approximate)");
  }
  console.log("");

  const grouped = groupByLayer(reports);
  for (const layer of LAYER_ORDER) {
    const inLayer = grouped.get(layer);
    if (!inLayer || inLayer.length === 0) continue;
    console.log(`[${layer}]`);
    for (const r of inLayer) {
      printReport(r);
    }
    console.log("");
  }

  const ungrouped = reports.filter((r) => r.entry.layers.length === 0);
  if (ungrouped.length > 0) {
    console.log("[uncategorized]");
    for (const r of ungrouped) printReport(r);
    console.log("");
  }

  printSummary(reports);

  if (malformed.length > 0) {
    console.warn("");
    console.warn(
      `${malformed.length} malformed catalog entr${malformed.length === 1 ? "y" : "ies"} skipped:`,
    );
    for (const m of malformed) {
      const tag = m.id ?? "(unparsed)";
      console.warn(`  - ${tag} [${m.sourceFile}]`);
      for (const err of m.errors) {
        console.warn(`      • ${err}`);
      }
    }
  }

  return 0;
}

async function buildReport(
  entry: CatalogEntry,
  cwd: string,
  lockfile: Lockfile | null,
): Promise<Report> {
  const detected = entry.detect.any_of.filter((p) =>
    existsSync(resolve(cwd, p)),
  );

  const lockedEntry = findLockedEntry(lockfile, entry.id);

  const providedPresent: string[] = [];
  const providedMissing: string[] = [];
  const driftChecks: Promise<ProvideDrift | null>[] = [];

  for (const p of entry.provides) {
    const dest = resolve(cwd, p.target);
    const src = resolve(CONTENT_DIR, p.source);
    if (existsSync(dest)) {
      providedPresent.push(p.target);
    } else {
      providedMissing.push(p.target);
    }
    driftChecks.push(
      classifyProvideDrift(src, dest, p.target, lockedEntry).then((kind) =>
        kind && kind !== "missing" ? { target: p.target, kind } : null,
      ),
    );
  }

  const driftResults = await Promise.all(driftChecks);
  const drift = driftResults.filter(
    (d): d is ProvideDrift => d !== null,
  );

  const missingTools = entry.requires.tools.filter((t) => !isToolAvailable(t));

  const versionDrift =
    lockedEntry && lockedEntry.version !== entry.version
      ? { installed: lockedEntry.version, current: entry.version }
      : null;

  let status: Status;
  if (detected.length === 0 && providedPresent.length === 0) {
    status = "missing";
  } else if (providedMissing.length === 0) {
    status = "installed";
  } else {
    status = "partial";
  }
  return {
    entry,
    status,
    detected,
    providedPresent,
    providedMissing,
    drift,
    missingTools,
    versionDrift,
  };
}

function groupByLayer(reports: Report[]): Map<Layer, Report[]> {
  const map = new Map<Layer, Report[]>();
  for (const r of reports) {
    for (const layer of r.entry.layers) {
      const arr = map.get(layer) ?? [];
      arr.push(r);
      map.set(layer, arr);
    }
  }
  return map;
}

function printReport(r: Report): void {
  const glyph = STATUS_GLYPH[r.status];
  const flags: string[] = [];

  const userEdits = r.drift.filter((d) => d.kind === "user-edit").length;
  const outOfDate = r.drift.filter((d) => d.kind === "out-of-date").length;
  if (userEdits > 0) flags.push(`${userEdits} user-edit${userEdits === 1 ? "" : "s"}`);
  if (outOfDate > 0) flags.push(`${outOfDate} out-of-date`);
  if (r.versionDrift) {
    flags.push(`v${r.versionDrift.installed}→${r.versionDrift.current}`);
  }
  if (r.missingTools.length > 0) {
    flags.push(`tool gap: ${r.missingTools.join(",")}`);
  }
  const flagStr = flags.length > 0 ? ` (${flags.join("; ")})` : "";

  console.log(`  ${glyph} ${r.entry.id.padEnd(16)} ${r.status}${flagStr}`);
  for (const target of r.providedMissing) {
    console.log(`      missing:     ${target}`);
  }
  for (const d of r.drift) {
    const label = d.kind === "user-edit" ? "user-edit:" : "out-of-date:";
    console.log(`      ${label.padEnd(12)} ${d.target}`);
  }
}

interface Summary {
  installed: number;
  partial: number;
  missing: number;
  userEdits: number;
  outOfDate: number;
  staleEntries: number;
  toolGaps: number;
}

function summarise(reports: Report[]): Summary {
  const out: Summary = {
    installed: 0,
    partial: 0,
    missing: 0,
    userEdits: 0,
    outOfDate: 0,
    staleEntries: 0,
    toolGaps: 0,
  };
  for (const r of reports) {
    out[r.status] += 1;
    for (const d of r.drift) {
      if (d.kind === "user-edit") out.userEdits += 1;
      else out.outOfDate += 1;
    }
    if (r.versionDrift) out.staleEntries += 1;
    if (r.missingTools.length > 0) out.toolGaps += 1;
  }
  return out;
}

function printSummary(reports: Report[]): void {
  const s = summarise(reports);
  const head = `${s.installed} installed, ${s.partial} partial, ${s.missing} missing`;
  const tail: string[] = [];
  if (s.userEdits > 0) tail.push(`${s.userEdits} user-edit${s.userEdits === 1 ? "" : "s"}`);
  if (s.outOfDate > 0) tail.push(`${s.outOfDate} out-of-date`);
  if (s.staleEntries > 0) {
    tail.push(`${s.staleEntries} stale entr${s.staleEntries === 1 ? "y" : "ies"}`);
  }
  if (s.toolGaps > 0) {
    tail.push(`${s.toolGaps} tool gap${s.toolGaps === 1 ? "" : "s"}`);
  }
  const tailStr = tail.length > 0 ? `; ${tail.join(", ")}` : "";
  console.log(`summary: ${head}${tailStr}`);
}
