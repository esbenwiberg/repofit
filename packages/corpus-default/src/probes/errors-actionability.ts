import { defineProbe } from "@esbenwiberg/repofit/sdk";

const PROBE_VERSION = "2.0.0";
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
  evidence: [
    "node_package",
    "python_project",
    "dotnet_project",
    "go_module",
    "toolchain",
    "files",
    "judge",
  ],

  rationale: `
    When an agent makes a change and a script fails, the error message is
    the only signal it has to act on. Tools that emit clear file:line
    diagnostics (Biome, TSC strict, Vitest, pytest, mypy, ruff, dotnet, go)
    let the agent self-correct; tools run with --silent or homegrown shell
    scripts that just exit 1 leave the agent guessing. This probe asks an LLM
    to judge the toolchain — which tools are configured, how they're scripted,
    and whether common feedback loops are present — for diagnostic quality.
  `,

  remediation:
    "Use tools that emit file:line:col diagnostics (TSC strict, Biome, ESLint, Vitest, Pytest, rustc). Remove `--silent` / `--quiet` / `2>/dev/null` from scripts. Avoid parallel runners that interleave output during failure investigation. Wire up the full feedback loop: typecheck, lint, test, build — each with a clear script name.",

  async detect(ev) {
    if (!ev.toolchain.primary && !ev.node_package.present) {
      return { kind: "na", reason: "no supported stack or package.json scripts" };
    }

    const nodeConfigs = [
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
    const presentNodeConfigs = nodeConfigs.filter((p) => ev.files.has(p));
    const pythonConfigs = [
      ev.python_project.pyproject?.path,
      ...(ev.python_project.configFiles ?? []),
    ].filter((p): p is string => typeof p === "string" && p.length > 0);
    const dotnetConfigs = [
      ...ev.dotnet_project.solutions,
      ...ev.dotnet_project.projects.map((p) => p.path),
      ev.dotnet_project.centralPackageManagement?.path,
    ].filter((p): p is string => typeof p === "string" && p.length > 0);
    const goConfigs = ev.go_module.modules.map((m) => m.path);

    const lines: string[] = ["# supported stacks", ""];
    lines.push(`primary: ${ev.toolchain.primary ?? "(none)"}`);
    lines.push(
      `detected: ${ev.toolchain.stacks.length === 0 ? "(none)" : ev.toolchain.stacks.join(", ")}`,
    );

    lines.push("", "# resolved toolchain commands", "");
    let commandCount = 0;
    for (const [phase, cmd] of Object.entries(ev.toolchain.commands)) {
      if (!cmd) continue;
      commandCount += 1;
      lines.push(`${phase}: ${cmd.argv.join(" ")} (${cmd.source})`);
    }

    const scripts = ev.node_package.scripts;
    const scriptEntries = Object.entries(scripts);
    lines.push("", "# package.json scripts", "");
    if (!ev.node_package.present) {
      lines.push("(no package.json)");
    } else if (scriptEntries.length === 0) {
      lines.push("(none detected)");
    }
    for (const [name, body] of Object.entries(scripts)) {
      commandCount += 1;
      lines.push(`${name}: ${shortString(body)}`);
    }

    if (commandCount === 0) {
      return { kind: "na", reason: "no toolchain commands configured" };
    }

    lines.push("", "# tool configs present", "");
    const presentConfigs = [
      ...presentNodeConfigs,
      ...pythonConfigs,
      ...dotnetConfigs,
      ...goConfigs,
    ];
    lines.push(presentConfigs.length === 0 ? "(none detected)" : presentConfigs.join("\n"));

    const deps = Object.keys({
      ...(ev.node_package.dependencies ?? {}),
      ...(ev.node_package.devDependencies ?? {}),
    });
    const toolDeps = deps.filter((d) =>
      /^(?:@biomejs|biome|eslint|prettier|typescript|vitest|jest|mocha|tsx|tsc|tap)\b/.test(d),
    );
    lines.push("", "# tool-related dependencies", "");
    lines.push(
      [
        ...toolDeps.sort(),
        ...(ev.python_project.pyproject?.toolHints ?? []),
        ...(ev.python_project.requirementsToolHints ?? []),
      ].join("\n") || "(none detected)",
    );

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
      name: "no-supported-stack",
      evidence: { node_package: { present: false }, toolchain: { primary: null } },
      expect: {
        reading: { kind: "na", reason: "no supported stack or package.json scripts" },
        score: null,
      },
    },
    {
      name: "empty-toolchain",
      evidence: {
        node_package: { present: true, scripts: {} },
        toolchain: { stacks: ["node"], primary: "node", commands: {} },
      },
      expect: { reading: { kind: "na", reason: "no toolchain commands configured" }, score: null },
    },
    {
      name: "strong-toolchain",
      evidence: {
        node_package: {
          present: true,
          scripts: { typecheck: "tsc --noEmit", lint: "biome check .", test: "vitest run" },
          devDependencies: { typescript: "^5", "@biomejs/biome": "^2", vitest: "^4" },
        },
        toolchain: {
          stacks: ["node"],
          primary: "node",
          commands: {
            typecheck: { source: "node", argv: ["npm", "run", "typecheck", "--silent"] },
            lint: { source: "node", argv: ["npm", "run", "lint", "--silent"] },
            test: { source: "node", argv: ["npm", "test", "--silent"] },
          },
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
      name: "strong-python-toolchain",
      evidence: {
        python_project: {
          present: true,
          pyproject: {
            path: "pyproject.toml",
            hasBuildSystem: true,
            tools: ["mypy", "pytest", "ruff"],
            toolHints: ["mypy", "pytest", "ruff"],
          },
          configFiles: ["pytest.ini"],
        },
        toolchain: {
          stacks: ["python"],
          primary: "python",
          commands: {
            build: { source: "python", argv: ["python", "-m", "build"] },
            typecheck: { source: "python", argv: ["mypy", "."] },
            lint: { source: "python", argv: ["ruff", "check", "."] },
            test: { source: "python", argv: ["pytest"] },
          },
        },
        files: ["pyproject.toml", "pytest.ini"],
        judge: {
          score: 80,
          perCriterion: {
            "tool-clarity": 80,
            "output-discipline": 80,
            "feedback-loop-coverage": 80,
          },
          rationale: "Pytest, Ruff, mypy, and python -m build provide clear diagnostics.",
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
          rationale: "Pytest, Ruff, mypy, and python -m build provide clear diagnostics.",
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
