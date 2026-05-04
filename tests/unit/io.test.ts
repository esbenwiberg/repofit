import { mkdir, writeFile, chmod } from "node:fs/promises";
import { delimiter, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fileExists,
  filesIdentical,
  isGitRepo,
  isToolAvailable,
} from "../../src/io.js";
import { makeGitRepoFixture, makeRepoFixture } from "../helpers/fixtures.js";

describe("isGitRepo", () => {
  it("returns true when .git exists", async () => {
    const cwd = await makeGitRepoFixture();
    expect(isGitRepo(cwd)).toBe(true);
  });

  it("returns false when .git is missing", async () => {
    const cwd = await makeRepoFixture();
    expect(isGitRepo(cwd)).toBe(false);
  });
});

describe("isToolAvailable", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("rejects names with shell metacharacters", () => {
    expect(isToolAvailable("foo;bar")).toBe(false);
    expect(isToolAvailable("foo bar")).toBe(false);
    expect(isToolAvailable("../bin/sh")).toBe(false);
    expect(isToolAvailable("$(rm)")).toBe(false);
  });

  it("finds a tool present on PATH", async () => {
    const dir = await makeRepoFixture();
    const exe = resolve(dir, "agentry-fake-tool");
    await writeFile(exe, "#!/bin/sh\nexit 0\n");
    await chmod(exe, 0o755);
    vi.stubEnv("PATH", dir);
    expect(isToolAvailable("agentry-fake-tool")).toBe(true);
  });

  it("returns false when tool is not on PATH", async () => {
    const dir = await makeRepoFixture();
    vi.stubEnv("PATH", dir);
    expect(isToolAvailable("agentry-definitely-not-a-real-tool")).toBe(false);
  });

  it("skips empty PATH segments without resolving cwd-relative names", async () => {
    const dir = await makeRepoFixture();
    vi.stubEnv("PATH", `${delimiter}${dir}`);
    expect(isToolAvailable("agentry-definitely-not-a-real-tool")).toBe(false);
  });
});

describe("fileExists", () => {
  it("returns true for a regular file", async () => {
    const dir = await makeRepoFixture({ "a.txt": "hi" });
    expect(fileExists(resolve(dir, "a.txt"))).toBe(true);
  });

  it("returns false for a missing path", async () => {
    const dir = await makeRepoFixture();
    expect(fileExists(resolve(dir, "nope.txt"))).toBe(false);
  });

  it("returns false for a directory", async () => {
    const dir = await makeRepoFixture();
    await mkdir(resolve(dir, "sub"));
    expect(fileExists(resolve(dir, "sub"))).toBe(false);
  });
});

describe("filesIdentical", () => {
  it("returns true when bytes match", async () => {
    const dir = await makeRepoFixture({ "a.txt": "same", "b.txt": "same" });
    expect(await filesIdentical(resolve(dir, "a.txt"), resolve(dir, "b.txt"))).toBe(true);
  });

  it("returns false when bytes differ", async () => {
    const dir = await makeRepoFixture({ "a.txt": "one", "b.txt": "two" });
    expect(await filesIdentical(resolve(dir, "a.txt"), resolve(dir, "b.txt"))).toBe(false);
  });

  it("returns false when either file is missing", async () => {
    const dir = await makeRepoFixture({ "a.txt": "hi" });
    expect(await filesIdentical(resolve(dir, "a.txt"), resolve(dir, "missing.txt"))).toBe(false);
    expect(await filesIdentical(resolve(dir, "missing.txt"), resolve(dir, "a.txt"))).toBe(false);
  });
});
