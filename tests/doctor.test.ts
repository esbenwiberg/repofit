import { describe, expect, it } from "vitest";
import {
  emptyLockfile,
  upsertLockedEntry,
  writeLockfile,
} from "../src/lockfile.js";
import { runCli } from "./helpers/cli.js";
import { makeRepoFixture } from "./helpers/fixtures.js";

describe("agentry doctor", () => {
  it("reports all entries as missing on an empty repo", async () => {
    const cwd = await makeRepoFixture();
    const res = await runCli(["doctor"], { cwd });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("agentry doctor");
    expect(res.stdout).toMatch(/0 installed/);
    expect(res.stdout).toMatch(/no agentry\.lock\.toml/);
  });

  it("reports a partial install when only some provides exist", async () => {
    const cwd = await makeRepoFixture({
      ".claude/skills/commits/skill.md": "user-supplied content",
    });
    const res = await runCli(["doctor"], { cwd });
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/commits\s+partial/);
  });

  it("flags an orphaned entry whose overlay is no longer registered", async () => {
    const cwd = await makeRepoFixture();
    const lf = upsertLockedEntry(emptyLockfile(), {
      id: "ghost-entry",
      version: "0.1.0",
      installed_at: "2026-01-01T00:00:00Z",
      overlay: "vanished",
      provides: [
        {
          target: ".claude/skills/ghost.md",
          source: "skills/ghost.md",
          flavor: "claude",
          checksum: "sha256:abc",
        },
      ],
    });
    await writeLockfile(cwd, lf);
    const res = await runCli(["doctor"], { cwd });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("[orphaned]");
    expect(res.stdout).toMatch(/ghost-entry\s+orphaned/);
    expect(res.stdout).toContain("overlay 'vanished' is not registered");
    expect(res.stdout).toMatch(/1 orphaned/);
  });

  it("flags an orphaned entry with no overlay tag (bundled removal)", async () => {
    const cwd = await makeRepoFixture();
    const lf = upsertLockedEntry(emptyLockfile(), {
      id: "removed-bundled",
      version: "0.1.0",
      installed_at: "2026-01-01T00:00:00Z",
      provides: [
        {
          target: ".claude/skills/old.md",
          source: "skills/old.md",
          flavor: "claude",
          checksum: "sha256:abc",
        },
      ],
    });
    await writeLockfile(cwd, lf);
    const res = await runCli(["doctor"], { cwd });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("no longer in bundled catalog");
  });
});
