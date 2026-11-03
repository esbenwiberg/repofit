import type { InventoryItem } from "@esbenwiberg/repofit/sdk";
import { defineProbe } from "@esbenwiberg/repofit/sdk";
import { agentFixture } from "./_shared/agent-evidence-fixture.js";
import { trackedTree } from "./_shared/agent-tree.js";

const PACKAGE_RUN_RE = /\b(?:npm|pnpm|yarn|bun)\s+run\s+([A-Za-z0-9:_.-]+)/g;
const MAKE_RE = /(?:^|[\s`;&|(])make\s+([A-Za-z0-9_./-]+)/g;
const PYTHON_RE = /\bpython3?\s+((?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.py)\b/g;
const DOT_SLASH_RE = /(?:^|[\s`;&|(])(\.\/[A-Za-z0-9_][A-Za-z0-9_./-]*)/g;
const MAKE_TARGET_RE = /^([A-Za-z0-9_./-]+)\s*:(?!=)/gm;
const TEMPLATE_RE = /[<>*{}$]/;

type Command = { kind: "script" | "make" | "python" | "path"; name: string; line: number };

function commandsIn(text: string): Command[] {
  const out: Command[] = [];
  for (const [i, raw] of text.split("\n").entries()) {
    const line = i + 1;
    for (const m of raw.matchAll(PACKAGE_RUN_RE))
      out.push({ kind: "script", name: m[1] ?? "", line });
    for (const m of raw.matchAll(MAKE_RE)) out.push({ kind: "make", name: m[1] ?? "", line });
    for (const m of raw.matchAll(PYTHON_RE)) out.push({ kind: "python", name: m[1] ?? "", line });
    for (const m of raw.matchAll(DOT_SLASH_RE)) out.push({ kind: "path", name: m[1] ?? "", line });
  }
  return out.filter((c) => !TEMPLATE_RE.test(c.name) && !c.name.startsWith("-"));
}

export default defineProbe({
  id: "agent.commands-resolve",
  version: "1.0.0",
  dimensions: [
    { id: "consistency", weight: 1 },
    { id: "context", weight: 0.7 },
  ],
  tier: "derived",
  evidence: ["agent_config", "files", "size_stats", "node_package"],

  rationale: `
    Instruction files tell the agent what to run. When the script was
    renamed and the file was not, every session either fails the command
    or, worse, guesses. The field study's drifted parallels are exactly one
    of two files naming a script the other had dropped. This checks
    \`npm|pnpm|yarn|bun run <script>\` against package.json scripts,
    \`make <target>\` against the Makefile, and \`python3 <path>.py\` and
    \`./<path>\` against the tracked tree. Toolchain verbs (\`cargo\`,
    \`go\`, \`dotnet\`) are not checked; they are not repository definitions.
  `,

  remediation:
    "Update each instruction file to the script, target or path that exists now, or restore the command it names. Keep one source of truth for commands (a routing root that links to `package.json` scripts) so renames have one place to land.",

  async detect(ev) {
    const sources = ev.agent_config.instructionFiles.filter((f) => !f.link);
    if (sources.length === 0) return { kind: "na", reason: "no instruction files" };
    const tree = trackedTree(ev.size_stats, ev.agent_config);
    const scripts = ev.node_package.present ? new Set(Object.keys(ev.node_package.scripts)) : null;
    const makefileText = tree.has("Makefile") ? await ev.files.readText("Makefile") : undefined;
    const targets =
      makefileText === undefined
        ? null
        : new Set([...makefileText.matchAll(MAKE_TARGET_RE)].map((m) => m[1] ?? ""));
    const items: InventoryItem[] = [];
    let checkable = 0;
    for (const file of sources) {
      const text = await ev.files.readText(file.path);
      if (text === undefined) continue;
      const seen = new Set<string>();
      for (const cmd of commandsIn(text)) {
        const key = `${cmd.kind}:${cmd.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let defined: boolean | null = null;
        let message = "";
        if (cmd.kind === "script" && scripts) {
          defined = scripts.has(cmd.name);
          message = `script "${cmd.name}" is not in package.json`;
        } else if (cmd.kind === "make" && targets) {
          defined = targets.has(cmd.name);
          message = `make target "${cmd.name}" is not in the Makefile`;
        } else if (cmd.kind === "python") {
          defined = tree.has(cmd.name);
          message = `${cmd.name} is not tracked`;
        } else if (cmd.kind === "path") {
          const path = cmd.name.slice(2);
          defined = tree.has(path) || tree.hasDir(path);
          message = `${cmd.name} is not tracked`;
        }
        if (defined === null) continue;
        checkable++;
        if (!defined) {
          items.push({
            location: { path: file.path, range: { startLine: cmd.line } },
            severity: "warn",
            message,
          });
        }
      }
    }
    if (checkable === 0) return { kind: "na", reason: "no checkable command named" };
    items.sort(
      (a, b) =>
        a.location.path.localeCompare(b.location.path) ||
        (a.location.range?.startLine ?? 0) - (b.location.range?.startLine ?? 0),
    );
    return { kind: "inventory", items };
  },

  score: {
    kind: "inventory",
    severityWeights: { info: 0, warn: 1, error: 1 },
    bands: [{ upTo: 0, score: 100 }, { upTo: 1, score: 70 }, { upTo: 3, score: 40 }, { score: 0 }],
  },

  fixtures: [
    {
      name: "no-checkable-command",
      evidence: {
        ...agentFixture({ files: { "AGENTS.md": "Run `cargo test` and `go vet ./...`.\n" } }),
        node_package: { present: false },
      },
      expect: { reading: { kind: "na", reason: "no checkable command named" }, score: null },
    },
    {
      name: "all-defined",
      evidence: {
        ...agentFixture({
          files: {
            "AGENTS.md":
              "Run `npm run verify`, `make lint`, `python3 scripts/check.py`, `./bin/dev`.\n",
            Makefile: "lint:\n\tbiome check\n\nVAR := 1\n",
            "scripts/check.py": "",
            "bin/dev": "",
          },
        }),
        node_package: { present: true, scripts: { verify: "tsc" } },
      },
      expect: { reading: { kind: "inventory", items: [] }, score: 100 },
    },
    {
      name: "renamed-script-and-moved-file",
      evidence: {
        ...agentFixture({
          files: {
            "AGENTS.md": "Run `pnpm run check` first.\n\nThen `python3 scripts/old.py`.\n",
            "CLAUDE.md": "Run `npm run check:all`; `make <target>` is a template.\n",
          },
        }),
        node_package: { present: true, scripts: { "check:all": "tsc" } },
      },
      expect: {
        reading: {
          kind: "inventory",
          items: [
            {
              location: { path: "AGENTS.md", range: { startLine: 1 } },
              severity: "warn",
              message: 'script "check" is not in package.json',
            },
            {
              location: { path: "AGENTS.md", range: { startLine: 3 } },
              severity: "warn",
              message: "scripts/old.py is not tracked",
            },
          ],
        },
        score: 40,
      },
    },
  ],
});
