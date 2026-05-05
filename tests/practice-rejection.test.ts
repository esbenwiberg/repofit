import { describe, expect, it } from "vitest";
import { runCli } from "./helpers/cli.js";
import { makeGitRepoFixture } from "./helpers/fixtures.js";

describe("practice entries are not installable", () => {
  it("agentry add commits → exits 1 with redirect to brief", async () => {
    const cwd = await makeGitRepoFixture();
    const res = await runCli(["add", "commits", "--non-interactive"], { cwd });
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("'commits' is a practice");
    expect(res.stderr).toContain("agentry brief");
    expect(res.stderr).toContain("overlay");
  });

  it("agentry add code-review → exits 1", async () => {
    const cwd = await makeGitRepoFixture();
    const res = await runCli(["add", "code-review", "--non-interactive"], { cwd });
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("practice");
  });

  it("agentry list shows the [practice] tag on bundled entries", async () => {
    const cwd = await makeGitRepoFixture();
    const res = await runCli(["list", cwd], { cwd });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("[practice]");
    expect(res.stdout).toMatch(/commits.*\[practice\]/);
  });
});
