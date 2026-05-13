import { defineProbe } from "@esbenwiberg/repofit/sdk";

const PROBE_VERSION = "1.0.0";
const MAX_INPUT_CHARS = 6_000;

const RUBRIC = {
  task: "Judge whether the toolchain configured in this repo would produce error messages that help a coding agent fix problems — not just say 'something broke'.",
  criteria: [
    {
      id: "tool-clarity",
      description:
        "Are the configured tools known to emit clear, located diagnostics — file:line:col plus a message that names the rule/type/assertion that failed? Biome, ESLint, TSC strict, Vitest, Pytest, and rustc score high; opaque homegrown shell scripts, build steps that just print 'failed', or tools run with --silent score low.",
    },
    {
      id: "output-discipline",
      description:
        "Do the scripts surface or hide diagnostic output? Flags like --silent / --quiet / 2>/dev/null hide useful errors. Parallel runners (npm-run-all -p, concurrently) interleave output so the agent can't tell which tool failed. Sequential runs with output preserved score higher.",
    },
    {
      id: "feedback-loop-coverage",
      description:
        "Are all the standard feedback loops wired up — typecheck, lint, test, build — so a failure has somewhere to surface? A repo with no test script means broken behaviour goes undetected; a repo with no typecheck means type errors only surface at runtime. Missing loops cost points.",
    },
  ],
} as const;

function shortString(s: unknown): string {
  if (typeof s !== "string") return "—";
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

export default defineProbe({
  id: "errors.actionability",
  version: PROBE_VERSION,
  dimensions: [{ id: "feedback", weight: 1 }],
  tier: "reasoned",
  evidence: ["node_package", "files", "judge"],

  rationale: `
    When an agent makes a change and a script fails, the error message is
    the only signal it has to act on. Tools that emit clear file:line
    diagnostics (Biome, TSC strict, Vitest) let the agent self-correct;
    tools run with --silent or homegrown shell scripts that just exit 1
    leave the agent guessing. This probe asks an LLM to judge the
    toolchain — which tools are configured, how they're scripted, and
    whether common feedback loops are present — for diagnostic quality.
  `,

  async detect(ev) {
    if (!ev.node_package.present) {
      return { kind: "na", reason: "no package.json" };
    }
    const scripts = ev.node_package.scripts;
    if (Object.keys(scripts).length === 0) {
      return { kind: "na", reason: "package.json has no scripts" };
    }

    const interestingConfigs = [
      "tsconfig.json",
      "biome.json",
      "biome.jsonc",
      "eslint.config.js",
      "eslint.config.mjs",
      ".eslintrc",
      ".eslintrc.json",
      ".eslintrc.cjs",
      "vitest.config.ts",
      "vitest.config.js",
      "jest.config.ts",
      "jest.config.js",
      ".prettierrc",
      "prettier.config.js",
    ];
    const presentConfigs = interestingConfigs.filter((p) => ev.files.has(p));

    const lines: string[] = ["# package.json scripts", ""];
    for (const [name, body] of Object.entries(scripts)) {
      lines.push(`${name}: ${shortString(body)}`);
    }
    lines.push("", "# tool configs present", "");
    lines.push(presentConfigs.length === 0 ? "(none detected)" : presentConfigs.join("\n"));

    const deps = Object.keys({
      ...(ev.node_package.dependencies ?? {}),
      ...(ev.node_package.devDependencies ?? {}),
    });
    const toolDeps = deps.filter((d) =>
      /^(?:@biomejs|biome|eslint|prettier|typescript|vitest|jest|mocha|tsx|tsc|tap)\b/.test(d),
    );
    lines.push("", "# tool-related dependencies", "");
    lines.push(toolDeps.length === 0 ? "(none detected)" : toolDeps.sort().join("\n"));

    const input = lines.join("\n").slice(0, MAX_INPUT_CHARS);

    const result = await ev.judge.score({
      probeId: "errors.actionability",
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
      name: "no-package-json",
      evidence: { node_package: { present: false } },
      expect: { reading: { kind: "na", reason: "no package.json" }, score: null },
    },
    {
      name: "empty-scripts",
      evidence: {
        node_package: { present: true, scripts: {} },
      },
      expect: { reading: { kind: "na", reason: "package.json has no scripts" }, score: null },
    },
    {
      name: "strong-toolchain",
      evidence: {
        node_package: {
          present: true,
          scripts: { typecheck: "tsc --noEmit", lint: "biome check .", test: "vitest run" },
          devDependencies: { typescript: "^5", "@biomejs/biome": "^2", vitest: "^4" },
        },
        files: ["tsconfig.json", "biome.json", "vitest.config.ts"],
        judge: {
          score: 80,
          perCriterion: {
            "tool-clarity": 80,
            "output-discipline": 80,
            "feedback-loop-coverage": 80,
          },
          rationale: "TSC, Biome, Vitest — all known for clear diagnostics; full loop covered.",
          model: "fixture",
        },
      },
      expect: {
        reading: {
          kind: "judge",
          score: 80,
          perCriterion: {
            "tool-clarity": 80,
            "output-discipline": 80,
            "feedback-loop-coverage": 80,
          },
          rationale: "TSC, Biome, Vitest — all known for clear diagnostics; full loop covered.",
          model: "fixture",
        },
        score: 80,
      },
    },
    {
      name: "opaque-scripts",
      evidence: {
        node_package: {
          present: true,
          scripts: { build: "./build.sh 2>/dev/null", test: "echo no tests" },
        },
        files: [],
        judge: {
          score: 20,
          perCriterion: {
            "tool-clarity": 0,
            "output-discipline": 20,
            "feedback-loop-coverage": 20,
          },
          rationale: "Homegrown script, output silenced, no real tests.",
          model: "fixture",
        },
      },
      expect: {
        reading: {
          kind: "judge",
          score: 20,
          perCriterion: {
            "tool-clarity": 0,
            "output-discipline": 20,
            "feedback-loop-coverage": 20,
          },
          rationale: "Homegrown script, output silenced, no real tests.",
          model: "fixture",
        },
        score: 20,
      },
    },
  ],
});
