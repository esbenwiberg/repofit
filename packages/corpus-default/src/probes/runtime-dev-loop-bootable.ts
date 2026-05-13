import { defineProbe } from "@esbenwiberg/repofit/sdk";

const PROBE_VERSION = "1.0.0";
const MAX_README_CHARS = 6_000;
const MAX_INPUT_CHARS = 14_000;

const BOOT_FILES = [
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
  "Dockerfile",
  ".devcontainer/devcontainer.json",
  ".devcontainer.json",
  "Makefile",
  "Procfile",
  "Taskfile.yml",
  "Taskfile.yaml",
  "justfile",
  ".env.example",
  ".env.sample",
  ".env.template",
];

const DATA_HINTS = [
  "fixtures",
  "fixture",
  "seeds",
  "seed",
  "sample-data",
  "samples",
  "examples",
  "demo",
  "demo-data",
  "mocks",
  "mock-data",
  "test-data",
  "scripts/seed.ts",
  "scripts/seed.js",
  "scripts/seed.sh",
  "prisma/seed.ts",
  "prisma/seed.js",
  "db/seeds",
];

const DEV_SCRIPT_HINTS = ["dev", "start", "serve", "watch", "run", "preview", "demo"];
const HEALTH_HINTS = [
  "smoke",
  "smoketest",
  "smoke-test",
  "e2e",
  "integration",
  "healthcheck",
  "health-check",
];

const README_SECTION =
  /^#+\s+(?:development|running locally|getting started|quickstart|setup|local dev|run|usage)/im;

const RUBRIC = {
  task: "Judge whether a coding agent landing in this repo can (a) get a working environment with one or two commands, (b) have sample data so the app does something interesting, and (c) verify its own changes — without having to ask a human.",
  criteria: [
    {
      id: "bootable",
      description:
        "Is there a one-or-two-command path to a running app? `docker compose up`, `npm run dev`, `make dev`, a devcontainer, or a documented sequence the agent can follow. A README that says 'set up your env, install deps, configure the database' without naming the commands scores low.",
    },
    {
      id: "has-data",
      description:
        "Once running, does the app have *something* in it? Seed scripts, fixtures, sample data, examples, or a demo mode. An empty app with no data lets the agent boot it but not see whether anything works.",
    },
    {
      id: "self-verifies",
      description:
        "Can the agent confirm its own change worked without asking a human — a smoke test, e2e suite, health endpoint, or a documented manual check (curl this URL, click this button)? 'Run the tests and call me' is the floor; integration/e2e checks score higher.",
    },
    {
      id: "documented",
      description:
        "Is the dev loop written down — in README, CONTRIBUTING, AGENTS.md / CLAUDE.md, or the entry-point script's comments? Implicit setups that work for the original author but require ambient knowledge score low.",
    },
  ],
} as const;

function findDataHints(allPaths: string[]): string[] {
  const hits = new Set<string>();
  for (const path of allPaths) {
    for (const h of DATA_HINTS) {
      if (
        path === h ||
        path.startsWith(`${h}/`) ||
        path.includes(`/${h}/`) ||
        path.endsWith(`/${h}`)
      ) {
        hits.add(h);
      }
    }
  }
  return [...hits].sort();
}

function findDevScripts(scripts: Record<string, string>): { name: string; body: string }[] {
  const matches: { name: string; body: string }[] = [];
  for (const [name, body] of Object.entries(scripts)) {
    if (DEV_SCRIPT_HINTS.some((h) => name === h || name.startsWith(`${h}:`))) {
      matches.push({ name, body });
    }
  }
  return matches;
}

function findHealthScripts(scripts: Record<string, string>): string[] {
  return Object.keys(scripts).filter((name) => HEALTH_HINTS.some((h) => name.includes(h)));
}

export default defineProbe({
  id: "runtime.dev-loop-bootable",
  version: PROBE_VERSION,
  dimensions: [
    { id: "feedback", weight: 1 },
    { id: "context", weight: 0.5 },
  ],
  tier: "reasoned",
  evidence: ["files", "size_stats", "node_package", "agent_config", "judge"],

  rationale: `
    The biggest jump in agent productivity comes when the agent can run
    the app, see its change take effect, and verify it. A repo without a
    bootable dev loop forces the agent to write code blind, hoping the
    tests cover what matters. This probe gathers the static signals — boot
    files (compose, devcontainer, Makefile), dev/start scripts, sample
    data, health/smoke/e2e tests, and documented setup — and asks an LLM
    whether they compose into a story an agent could follow alone.
  `,

  async detect(ev) {
    const allPaths = ev.size_stats.files.map((f) => f.path);
    const bootFilesFound = BOOT_FILES.filter((p) => ev.files.has(p));
    const dataHints = findDataHints(allPaths);

    const scripts = ev.node_package.present ? ev.node_package.scripts : {};
    const devScripts = findDevScripts(scripts);
    const healthScripts = findHealthScripts(scripts);

    const readme = await ev.files.readText("README.md");
    const guidancePaths = ev.agent_config.guidance.map((g) => g.path);
    const contributing =
      (await ev.files.readText("CONTRIBUTING.md")) ??
      (await ev.files.readText("docs/CONTRIBUTING.md"));

    const readmeHasDevSection = readme ? README_SECTION.test(readme) : false;
    const readmeSlice = readme ? readme.slice(0, MAX_README_CHARS) : "";

    if (
      bootFilesFound.length === 0 &&
      devScripts.length === 0 &&
      dataHints.length === 0 &&
      !readmeHasDevSection &&
      !contributing &&
      guidancePaths.length === 0
    ) {
      return { kind: "na", reason: "no dev-loop signals (boot files, dev scripts, data, docs)" };
    }

    const lines: string[] = [];
    lines.push("# Boot files present");
    lines.push(bootFilesFound.length === 0 ? "(none)" : bootFilesFound.join("\n"));
    lines.push("", "# Dev / start scripts (package.json)");
    if (devScripts.length === 0) {
      lines.push("(none)");
    } else {
      for (const s of devScripts) lines.push(`${s.name}: ${s.body}`);
    }
    lines.push("", "# Sample-data / fixture indicators (paths)");
    lines.push(dataHints.length === 0 ? "(none detected)" : dataHints.join("\n"));
    lines.push("", "# Health / smoke / e2e scripts");
    lines.push(healthScripts.length === 0 ? "(none)" : healthScripts.join("\n"));
    lines.push("", "# Agent-guidance files present");
    lines.push(guidancePaths.length === 0 ? "(none)" : guidancePaths.join("\n"));
    lines.push("", "# CONTRIBUTING.md present", contributing ? "yes" : "no");
    lines.push("", "# README excerpt", "", readmeSlice || "(no README.md)");

    const input = lines.join("\n").slice(0, MAX_INPUT_CHARS);

    const result = await ev.judge.score({
      probeId: "runtime.dev-loop-bootable",
      probeVersion: PROBE_VERSION,
      input,
      rubric: RUBRIC,
    });

    return {
      kind: "judge",
      score: result.score,
      perCriterion: result.perCriterion,
      rationale: result.rationale,
      model: result.model,
    };
  },

  score: { kind: "judge" },

  fixtures: [
    {
      name: "no-signals",
      evidence: {
        node_package: { present: false },
        size_stats: { files: [], totalBytes: 0, totalFiles: 0, source: "git-ls-files" },
        agent_config: { guidance: [] },
      },
      expect: {
        reading: {
          kind: "na",
          reason: "no dev-loop signals (boot files, dev scripts, data, docs)",
        },
        score: null,
      },
    },
    {
      name: "compose-and-seed",
      evidence: {
        files: { "README.md": "# proj\n\n## Development\n\ndocker compose up; npm run seed.\n" },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 200,
          totalFiles: 2,
          files: [
            { path: "docker-compose.yml", bytes: 100, lines: 10, depth: 0 },
            { path: "fixtures/users.json", bytes: 100, lines: 10, depth: 1 },
          ],
        },
        node_package: {
          present: true,
          scripts: { dev: "next dev", seed: "tsx scripts/seed.ts", "test:e2e": "playwright test" },
        },
        agent_config: { guidance: [{ path: "CLAUDE.md", bytes: 100, lines: 10 }] },
        judge: {
          score: 80,
          perCriterion: {
            bootable: 80,
            "has-data": 80,
            "self-verifies": 80,
            documented: 80,
          },
          rationale: "Compose + dev script + fixtures + e2e — full loop.",
          model: "fixture",
        },
      },
      expect: {
        reading: {
          kind: "judge",
          score: 80,
          perCriterion: {
            bootable: 80,
            "has-data": 80,
            "self-verifies": 80,
            documented: 80,
          },
          rationale: "Compose + dev script + fixtures + e2e — full loop.",
          model: "fixture",
        },
        score: 80,
      },
    },
  ],
});
