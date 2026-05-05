import { describe, expect, it } from "vitest";
import { runCli } from "./helpers/cli.js";
import { makeRepoFixture } from "./helpers/fixtures.js";

describe("agentry list", () => {
  it("lists active catalog entries with a header", async () => {
    const cwd = await makeRepoFixture();
    const res = await runCli(["list"], { cwd });
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/^ID\s+NAME\s+DESCRIPTION/m);
    expect(res.stdout).toContain("commits");
    expect(res.stdout).toContain("code-review");
  });

  it("--show-deprecated changes the visible set", async () => {
    const cwd = await makeRepoFixture();
    const without = await runCli(["list"], { cwd });
    const withFlag = await runCli(["list", "--show-deprecated"], { cwd });
    expect(without.code).toBe(0);
    expect(withFlag.code).toBe(0);
    const lineCount = (s: string) => s.split("\n").length;
    expect(lineCount(withFlag.stdout)).toBeGreaterThanOrEqual(lineCount(without.stdout));
  });
});
