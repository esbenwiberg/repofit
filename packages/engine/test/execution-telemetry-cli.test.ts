import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

const cli = resolve(import.meta.dirname, "../dist/cli/index.js");

test("real CLI retains existing warm-up/measured attempts, while static scans execute none", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "repofit-cli-evidence-"));
  try {
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ scripts: { "test:agent": "node check.cjs" } }),
    );
    await writeFile(join(cwd, "README.md"), "# Example\n");
    await writeFile(
      join(cwd, "check.cjs"),
      `const fs = require('node:fs');
      const n = fs.existsSync('attempts') ? Number(fs.readFileSync('attempts', 'utf8')) + 1 : 1;
      fs.writeFileSync('attempts', String(n)); process.stdout.write('attempt ' + n); process.exit(n === 1 ? 7 : 0);`,
    );
    const invoke = (args: string[]) =>
      spawnSync(process.execPath, [cli, "check", ...args, "--json"], {
        cwd,
        encoding: "utf8",
        timeout: 30_000,
      });
    const statics = invoke(["--probe", "docs.readme-present"]);
    expect(statics.status, statics.stderr).toBe(0);
    expect(JSON.parse(statics.stdout).executions).toEqual([]);
    await expect(readFile(join(cwd, "attempts"), "utf8")).rejects.toThrow();
    const executed = invoke(["--probe", "latency.test-suite", "--include", "executed"]);
    expect(executed.status, executed.stderr).toBe(0);
    const report = JSON.parse(executed.stdout);
    expect(
      report.executions.map((r: { role: string; exitCode: number }) => [r.role, r.exitCode]),
    ).toEqual([
      ["warmup", 7],
      ["measured", 0],
    ]);
    expect(report.probes[0].score).toBe(100);
    expect(await readFile(join(cwd, "attempts"), "utf8")).toBe("2");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}, 40_000);
