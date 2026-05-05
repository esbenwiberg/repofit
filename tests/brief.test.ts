import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "./helpers/cli.js";
import { makeRepoFixture } from "./helpers/fixtures.js";

async function findOnlyBundle(cwd: string): Promise<string> {
  const root = join(cwd, ".agentry", "scan");
  const entries = await readdir(root);
  expect(entries.length).toBe(1);
  return join(root, entries[0]!);
}

describe("agentry brief", () => {
  it("fails when no scan bundle exists", async () => {
    const cwd = await makeRepoFixture({ "README.md": "# demo\n" });
    const res = await runCli(["brief"], { cwd });
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("no scan bundle found");
  });

  it("emits instructions.md against the latest bundle and references catalog", async () => {
    const cwd = await makeRepoFixture({
      "README.md": "# demo\n",
      "package.json": JSON.stringify({ name: "demo" }),
    });
    const scanRes = await runCli(["scan", "--no-fitness"], { cwd });
    expect(scanRes.code).toBe(0);

    const briefRes = await runCli(["brief"], { cwd });
    expect(briefRes.code).toBe(0);
    expect(briefRes.stdout).toContain("agentry brief");

    const bundle = await findOnlyBundle(cwd);
    const briefPath = join(bundle, "instructions.md");
    expect(existsSync(briefPath)).toBe(true);

    const body = await readFile(briefPath, "utf8");
    expect(body).toContain("# agentry brief");
    expect(body).toContain("catalog.json");
    expect(body).toContain("Diagnosis");
    expect(body).toContain("Shopping list");
    expect(body).toContain("Author plan");
    expect(body).toContain("structure/tree.txt");
    expect(body).toContain("agent-readiness/report.json");
  });

  it("warns when fitness was skipped", async () => {
    const cwd = await makeRepoFixture({ "README.md": "# demo\n" });
    await runCli(["scan", "--no-fitness"], { cwd });
    await runCli(["brief"], { cwd });

    const bundle = await findOnlyBundle(cwd);
    const body = await readFile(join(bundle, "instructions.md"), "utf8");
    expect(body).toContain("Fitness was skipped");
    expect(body).toContain("--no-fitness");
  });

  it("accepts an explicit --scan dir", async () => {
    const cwd = await makeRepoFixture({ "README.md": "# demo\n" });
    await runCli(["scan", "--no-fitness"], { cwd });
    const bundle = await findOnlyBundle(cwd);

    const res = await runCli(["brief", "--scan", bundle], { cwd });
    expect(res.code).toBe(0);
    expect(existsSync(join(bundle, "instructions.md"))).toBe(true);
  });

  it("inlines bundled practice docs into instructions.md", async () => {
    const cwd = await makeRepoFixture({ "README.md": "# demo\n" });
    await runCli(["scan", "--no-fitness"], { cwd });
    await runCli(["brief"], { cwd });

    const bundle = await findOnlyBundle(cwd);
    const body = await readFile(join(bundle, "instructions.md"), "utf8");
    expect(body).toContain("## Practice library");
    expect(body).toContain("(`commits`)");
    expect(body).toContain("(`code-review`)");
    expect(existsSync(join(bundle, "practices", "commits.md"))).toBe(true);
    expect(existsSync(join(bundle, "practices", "code-review.md"))).toBe(true);
  });
});
