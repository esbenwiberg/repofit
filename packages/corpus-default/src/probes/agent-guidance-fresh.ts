import { defineProbe } from "@esbenwiberg/repofit/sdk";
import { readGuidanceParts } from "./_shared/guidance-content.js";

const PROBE_VERSION = "2.0.0";
const MAX_GUIDANCE_CHARS = 12_000;
const MAX_TREE_ENTRIES = 200;
const MAX_DEPENDENCY_NAMES = 150;
const TEST_FILE_RE = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py)$/;

const RUBRIC = {
  task: "Score whether the claims in the root agent-instruction file(s) still match the repository. Deterministic probes have already checked that every referenced path, skill and command exists; do not score those. Score only claims that need reading to test: version numbers and tool names against the manifest, the described architecture against the tree summary, and statements about what exists or does not exist ('no tests', 'single package', 'no CI') against the counts given. A claim the snapshot cannot confirm or deny is neutral, not stale.",
  criteria: [
    {
      id: "versions-match-manifest",
      description:
        "Do runtime, language and tool versions and names stated in the guidance ('Node 18', 'Python 3.9', 'we use Jest') agree with the manifest summary (engines, dependency names, versions)? A contradiction scores low; no version claims at all is 100.",
    },
    {
      id: "architecture-matches",
      description:
        "Does the described structure (packages, modules, layering, where major code lives) match the top-level tree summary? Penalise packages or modules described but absent, and major directories present that the description would have to mention to be true.",
    },
    {
      id: "existence-claims-match-counts",
      description:
        "Do statements of what exists or does not ('no tests', 'no CI', 'single package', 'the monorepo has three apps') agree with the counts given (test files, workflows, packages)? 'No tests' next to a non-zero test-file count scores 0.",
    },
    {
      id: "no-stale-claims",
      description:
        "Are there status claims that look outdated: 'in progress' or 'coming soon' markers, 'temporary' workarounds, migrations 'underway', deadlines? Each one that the snapshot suggests has long since resolved costs points; none is 100.",
    },
  ],
} as const;

export default defineProbe({
  id: "agent.guidance-fresh",
  version: PROBE_VERSION,
  dimensions: [
    { id: "context", weight: 1 },
    { id: "consistency", weight: 0.5 },
  ],
  tier: "reasoned",
  evidence: ["agent_config", "files", "node_package", "size_stats", "judge"],

  rationale: `
    A well-written root that is out of date sends every agent confidently
    into a dead end. Whether a path or command still exists is checked
    deterministically (agent.references-resolve, agent.commands-resolve);
    this probe covers the claims those cannot test. It hands a model the
    guidance beside a snapshot the evidence can vouch for (top-level tree,
    manifest name, version, engines and dependency names, counts of test
    files and workflows) and asks only about version claims, the described
    architecture, existence claims and status markers. The field study
    found "no tests found" in roots of repositories with hundreds of test
    files, and runtime versions two majors behind the manifest.
  `,

  remediation:
    "Sweep the root against the current repository: every version and tool name should match the manifest, the architecture description should match the tree, every 'no X' or 'single Y' claim should still be true, and every 'in progress' or 'temporary' marker should either be current or deleted. Then re-run this probe.",

  async detect(ev) {
    const guidance = ev.agent_config.guidance;
    if (guidance.length === 0) {
      return { kind: "na", reason: "no agent-guidance file present" };
    }

    const parts = (await readGuidanceParts(guidance, ev.files, MAX_GUIDANCE_CHARS)).map(
      (part) => `# ${part.path}\n\n${part.text}`,
    );
    if (parts.length === 0) {
      return { kind: "na", reason: "agent-guidance files declared but unreadable" };
    }

    const topLevel = new Set<string>();
    let testFiles = 0;
    let workflows = 0;
    let manifests = 0;
    for (const f of ev.size_stats.files) {
      const top = f.path.split("/")[0];
      if (top) topLevel.add(top);
      if (TEST_FILE_RE.test(f.path)) testFiles += 1;
      if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(f.path)) workflows += 1;
      if (/(^|\/)package\.json$/.test(f.path) && !f.path.includes("node_modules")) manifests += 1;
    }
    const treeEntries = Array.from(topLevel).sort().slice(0, MAX_TREE_ENTRIES);
    const sections = [
      `## Top-level entries\n${treeEntries.join("\n")}`,
      `## Counts\n- tracked files: ${ev.size_stats.totalFiles}\n- test files (by path pattern): ${testFiles}\n- GitHub workflows: ${workflows}\n- package.json manifests: ${manifests}`,
    ];

    if (ev.node_package.present) {
      const raw = ev.node_package.raw ?? {};
      const scalar = (key: string) => {
        const v = raw[key];
        return typeof v === "string" ? v : undefined;
      };
      const engines =
        raw.engines && typeof raw.engines === "object" ? JSON.stringify(raw.engines) : undefined;
      const names = Object.keys({
        ...ev.node_package.dependencies,
        ...ev.node_package.devDependencies,
      })
        .sort()
        .slice(0, MAX_DEPENDENCY_NAMES);
      const scripts = Object.keys(ev.node_package.scripts).sort();
      sections.push(
        [
          "## package.json",
          `- name: ${scalar("name") ?? "(none)"}`,
          `- version: ${scalar("version") ?? "(none)"}`,
          `- engines: ${engines ?? "(none)"}`,
          `- scripts: ${scripts.join(", ") || "(none)"}`,
          `- dependencies: ${names.join(", ") || "(none)"}`,
        ].join("\n"),
      );
    }

    const input = [
      "# ALREADY CHECKED BY DETERMINISTIC PROBES (do not score)",
      "",
      "That every referenced path, skill and command exists.",
      "",
      "---",
      "",
      "# REPO SNAPSHOT",
      "",
      sections.join("\n\n"),
      "",
      "---",
      "",
      "# AGENT GUIDANCE",
      "",
      parts.join("\n\n---\n\n"),
    ].join("\n");

    const result = await ev.judge.score({
      probeId: "agent.guidance-fresh",
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
      name: "no-guidance",
      evidence: {
        agent_config: { guidance: [] },
        node_package: { present: false },
        size_stats: { files: [], totalBytes: 0, totalFiles: 0, source: "git-ls-files" },
      },
      expect: { reading: { kind: "na", reason: "no agent-guidance file present" }, score: null },
    },
    {
      name: "fresh-guidance",
      evidence: {
        agent_config: { guidance: [{ path: "CLAUDE.md", bytes: 500, lines: 20 }] },
        files: {
          "CLAUDE.md":
            "# Project\n\nSingle package on Node 22. Main code lives in `src/`; tests are vitest under `test/`.",
        },
        node_package: {
          present: true,
          scripts: { test: "vitest", build: "tsc" },
          devDependencies: { vitest: "^3.0.0" },
          raw: { name: "proj", version: "1.0.0", engines: { node: ">=22" } },
        },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 500,
          totalFiles: 3,
          files: [
            { path: "src/index.ts", bytes: 300, lines: 10, depth: 1 },
            { path: "test/index.test.ts", bytes: 100, lines: 5, depth: 1 },
            { path: "CLAUDE.md", bytes: 100, lines: 10, depth: 0 },
          ],
        },
        judge: {
          score: 90,
          perCriterion: {
            "versions-match-manifest": 100,
            "architecture-matches": 80,
            "existence-claims-match-counts": 100,
            "no-stale-claims": 80,
          },
          rationale: "Node 22 and vitest match the manifest; counts agree.",
          model: "fixture",
        },
      },
      expect: {
        reading: {
          kind: "judge",
          score: 90,
          perCriterion: {
            "versions-match-manifest": 100,
            "architecture-matches": 80,
            "existence-claims-match-counts": 100,
            "no-stale-claims": 80,
          },
          rationale: "Node 22 and vitest match the manifest; counts agree.",
          model: "fixture",
        },
        score: 90,
      },
    },
    {
      name: "stale-guidance",
      evidence: {
        agent_config: { guidance: [{ path: "CLAUDE.md", bytes: 500, lines: 20 }] },
        files: {
          "CLAUDE.md":
            "# Project\n\nNode 16 with Jest. No tests found yet. Code lives in `lib/`. The `experimental/` folder is 🚧 in progress.",
        },
        node_package: {
          present: true,
          scripts: { test: "vitest" },
          devDependencies: { vitest: "^3.0.0" },
          raw: { name: "proj", version: "4.2.0", engines: { node: ">=22" } },
        },
        size_stats: {
          source: "git-ls-files",
          totalBytes: 500,
          totalFiles: 3,
          files: [
            { path: "src/index.ts", bytes: 300, lines: 10, depth: 1 },
            { path: "src/index.test.ts", bytes: 100, lines: 5, depth: 1 },
            { path: "CLAUDE.md", bytes: 100, lines: 10, depth: 0 },
          ],
        },
        judge: {
          score: 20,
          perCriterion: {
            "versions-match-manifest": 0,
            "architecture-matches": 20,
            "existence-claims-match-counts": 0,
            "no-stale-claims": 50,
          },
          rationale:
            "Claims Node 16 and Jest against Node 22 and vitest; says no tests but one exists.",
          model: "fixture",
        },
      },
      expect: {
        reading: {
          kind: "judge",
          score: 20,
          perCriterion: {
            "versions-match-manifest": 0,
            "architecture-matches": 20,
            "existence-claims-match-counts": 0,
            "no-stale-claims": 50,
          },
          rationale:
            "Claims Node 16 and Jest against Node 22 and vitest; says no tests but one exists.",
          model: "fixture",
        },
        score: 20,
      },
    },
  ],
});
