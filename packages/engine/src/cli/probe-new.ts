import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type ProbeKind = "predicate" | "count" | "magnitude";

const VALID_KINDS = new Set<ProbeKind>(["predicate", "count", "magnitude"]);

export type ProbeNewOptions = {
  id: string;
  kind?: string;
  dir?: string;
};

export async function probeNew(
  opts: ProbeNewOptions,
): Promise<{ stdout: string; exitCode: number }> {
  const kind = (opts.kind ?? "predicate") as ProbeKind;
  if (!VALID_KINDS.has(kind)) {
    return {
      stdout: `repofit: --kind must be one of: ${[...VALID_KINDS].join(", ")} (got '${kind}')\n`,
      exitCode: 2,
    };
  }

  if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(opts.id)) {
    return {
      stdout:
        "repofit: probe id must look like 'category.what-it-checks' " +
        "(lowercase, dot-separated, kebab-case segments).\n" +
        `Got: '${opts.id}'\n`,
      exitCode: 2,
    };
  }

  const dir = opts.dir ?? path.join(process.cwd(), "probes");
  const filename = `${opts.id.replace(/\./g, "-")}.ts`;
  const filepath = path.join(dir, filename);

  await mkdir(dir, { recursive: true });
  await writeFile(filepath, scaffold(opts.id, kind), { flag: "wx" }).catch((err) => {
    if (err.code === "EEXIST") throw new Error(`refusing to overwrite ${filepath}`);
    throw err;
  });

  return {
    stdout: [
      `wrote ${filepath}`,
      "",
      "next steps:",
      "  1. Edit the file: fill in rationale, remediation, detect(), and fixtures.",
      "  2. Register it: import the probe in your corpus index.ts and add it to the `probes` array.",
      "  3. Test it: run your test suite — fixtures are executed as unit tests.",
      "",
      "docs: see docs/authoring.md for the full guide.",
      "",
    ].join("\n"),
    exitCode: 0,
  };
}

function scaffold(id: string, kind: ProbeKind): string {
  switch (kind) {
    case "predicate":
      return predicateScaffold(id);
    case "count":
      return countScaffold(id);
    case "magnitude":
      return magnitudeScaffold(id);
  }
}

function predicateScaffold(id: string): string {
  return `import { defineProbe } from "@esbenwiberg/repofit/sdk";

export default defineProbe({
  id: "${id}",
  version: "0.1.0",
  // Which dimensions does this probe contribute to, and how strongly?
  // Pick from your corpus' dimensions. Weight is relative (1 = full weight).
  dimensions: [{ id: "consistency", weight: 1 }],
  // static = pure file inspection, derived = computed from evidence, executed = runs a command,
  // historical = reads git history, reasoned = invokes an LLM judge.
  tier: "static",
  // Evidence subsystems this probe needs. The runner gathers them once and shares.
  evidence: ["files"],

  rationale: \`
    Replace this with the *why* of the probe — what failure mode it catches,
    and why a coding agent benefits from the signal. 2–4 sentences.
  \`,

  // Shown in reports when this probe fails. Be concrete and actionable.
  remediation: "Replace this with concrete steps an agent (or human) can follow to fix the failure.",

  async detect(ev) {
    // Read evidence and return a Reading.
    // For a simple "does this file exist?" check:
    const present = ev.files.has("YOUR_FILE_HERE");
    return { kind: "predicate", value: present };
  },

  // predicate scoring: true → 100, false → 0 ("positive"), or invert with "negative".
  score: { kind: "predicate", direction: "positive" },

  // At least one fixture is required. Fixtures are executed as unit tests during \`npm test\`.
  fixtures: [
    {
      name: "present",
      evidence: { files: ["YOUR_FILE_HERE"] },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "absent",
      evidence: { files: [] },
      expect: { reading: { kind: "predicate", value: false }, score: 0 },
    },
  ],
});
`;
}

function countScaffold(id: string): string {
  return `import type { Location } from "@esbenwiberg/repofit/sdk";
import { defineProbe } from "@esbenwiberg/repofit/sdk";

export default defineProbe({
  id: "${id}",
  version: "0.1.0",
  dimensions: [{ id: "consistency", weight: 1 }],
  tier: "derived",
  evidence: ["size_stats"],

  rationale: \`
    Replace this with the *why* — what does counting this thing tell an agent?
  \`,

  remediation: "Replace this with concrete steps to bring the count into a healthier range.",

  async detect(ev) {
    if (ev.size_stats.source === "none") {
      return { kind: "na", reason: "no git working tree" };
    }
    const samples: Location[] = [];
    for (const f of ev.size_stats.files) {
      // Replace this predicate with the thing you actually want to count.
      if (f.path.endsWith(".YOUR_EXTENSION")) {
        samples.push({ path: f.path });
      }
    }
    return { kind: "count", value: samples.length, samples: samples.slice(0, 5) };
  },

  // Use "negative" if more = worse (e.g., dead code, large files).
  // Use "positive" if more = better (e.g., ADRs, tests).
  score: {
    kind: "count",
    direction: "positive",
    bands: [
      { upTo: 0, score: 0 },
      { upTo: 2, score: 50 },
      { upTo: 5, score: 80 },
      { score: 100 },
    ],
  },

  fixtures: [
    {
      name: "none",
      evidence: {
        size_stats: { source: "git-ls-files", totalBytes: 0, totalFiles: 0, files: [] },
      },
      expect: { reading: { kind: "count", value: 0, samples: [] }, score: 0 },
    },
  ],
});
`;
}

function magnitudeScaffold(id: string): string {
  return `import { defineProbe } from "@esbenwiberg/repofit/sdk";

export default defineProbe({
  id: "${id}",
  version: "0.1.0",
  dimensions: [{ id: "latency", weight: 1 }],
  tier: "executed",
  evidence: ["node_package", "commands"],

  rationale: \`
    Replace this with the *why* — what does this measurement tell an agent?
  \`,

  remediation: "Replace this with how to bring the magnitude into a healthier range.",

  async detect(ev) {
    if (!ev.node_package.present) return { kind: "na", reason: "no package.json" };
    // Example: measure the wall-clock time of a script. Replace "your-script" with the real one.
    const script = ev.node_package.scripts["your-script"];
    if (typeof script !== "string" || script.trim().length === 0) {
      return { kind: "na", reason: "no your-script script" };
    }
    const run = await ev.commands.run({
      argv: ["npm", "run", "your-script", "--silent"],
      warmup: 1,
      timeoutMs: 300_000,
    });
    if (run.timedOut) return { kind: "na", reason: "your-script timed out" };
    if (run.exitCode !== 0) return { kind: "na", reason: \`your-script exited \${run.exitCode}\` };
    return { kind: "magnitude", value: run.durationMs, unit: "ms" };
  },

  // Use "negative" when smaller = better (latency, file size).
  // Use "positive" when larger = better (test count, coverage %).
  score: {
    kind: "magnitude",
    direction: "negative",
    bands: [
      { upTo: 10_000, score: 100 },
      { upTo: 30_000, score: 80 },
      { upTo: 120_000, score: 50 },
      { upTo: 300_000, score: 20 },
      { score: 0 },
    ],
  },

  fixtures: [
    {
      name: "no-script",
      evidence: { node_package: { present: true, scripts: {} } },
      expect: { reading: { kind: "na", reason: "no your-script script" }, score: null },
    },
  ],
});
`;
}
