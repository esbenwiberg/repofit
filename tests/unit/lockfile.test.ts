import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  emptyLockfile,
  findLockedEntry,
  findLockedProvide,
  lockfilePath,
  mergeLockedProvides,
  readLockfile,
  removeLockedEntry,
  sha256OfFile,
  upsertLockedEntry,
  writeLockfile,
  type LockedEntry,
} from "../../src/lockfile.js";
import { makeRepoFixture } from "../helpers/fixtures.js";

const sampleEntry: LockedEntry = {
  id: "commits",
  version: "0.2.0",
  installed_at: "2026-01-01T00:00:00Z",
  provides: [
    {
      target: ".claude/skills/commits/skill.md",
      source: "skills/commits/skill.md",
      flavor: "claude",
      checksum: "sha256:abc",
    },
    {
      target: ".githooks/commit-msg",
      source: "hooks/commit-msg",
      flavor: "agnostic",
      checksum: "sha256:def",
    },
  ],
};

describe("lockfile read/write", () => {
  it("readLockfile returns null when no lockfile exists", async () => {
    const cwd = await makeRepoFixture();
    expect(await readLockfile(cwd)).toBeNull();
  });

  it("readLockfile returns empty installed array on empty lockfile", async () => {
    const cwd = await makeRepoFixture();
    await writeLockfile(cwd, emptyLockfile());
    const lf = await readLockfile(cwd);
    expect(lf).not.toBeNull();
    expect(lf!.installed).toEqual([]);
  });

  it("round-trips an entry through write/read", async () => {
    const cwd = await makeRepoFixture();
    const lf = upsertLockedEntry(emptyLockfile(), sampleEntry);
    await writeLockfile(cwd, lf);
    const restored = await readLockfile(cwd);
    expect(restored).not.toBeNull();
    expect(restored!.installed).toHaveLength(1);
    expect(restored!.installed[0]!.id).toBe("commits");
    expect(restored!.installed[0]!.provides).toHaveLength(2);
    expect(restored!.installed[0]!.provides[0]!.checksum).toBe("sha256:abc");
  });

  it("readLockfile returns null on malformed TOML", async () => {
    const cwd = await makeRepoFixture({
      "agentry.lock.toml": "not = valid = toml = [garbage",
    });
    expect(await readLockfile(cwd)).toBeNull();
  });

  it("round-trips the overlay field when set", async () => {
    const cwd = await makeRepoFixture();
    const entry: LockedEntry = {
      ...sampleEntry,
      id: "from-overlay",
      overlay: "acme",
    };
    const lf = upsertLockedEntry(emptyLockfile(), entry);
    await writeLockfile(cwd, lf);
    const restored = await readLockfile(cwd);
    expect(restored!.installed[0]!.overlay).toBe("acme");
  });

  it("omits the overlay field for bundled entries", async () => {
    const cwd = await makeRepoFixture();
    const lf = upsertLockedEntry(emptyLockfile(), sampleEntry);
    await writeLockfile(cwd, lf);
    const restored = await readLockfile(cwd);
    expect(restored!.installed[0]!.overlay).toBeUndefined();
  });

  it("drops a non-string overlay field on read", async () => {
    const cwd = await makeRepoFixture({
      "agentry.lock.toml": [
        `[[installed]]`,
        `id = "weird"`,
        `version = "0.1.0"`,
        `installed_at = "2026-01-01T00:00:00Z"`,
        `overlay = 42`,
        ``,
        `[[installed.provides]]`,
        `target = ".claude/x.md"`,
        `source = "skills/x.md"`,
        `flavor = "claude"`,
        `checksum = "sha256:abc"`,
      ].join("\n"),
    });
    const lf = await readLockfile(cwd);
    expect(lf!.installed[0]!.overlay).toBeUndefined();
  });
});

describe("sha256OfFile", () => {
  it("returns a sha256:<hex> digest matching the file bytes", async () => {
    const cwd = await makeRepoFixture({ "a.txt": "hello" });
    const digest = await sha256OfFile(resolve(cwd, "a.txt"));
    expect(digest).toBe(
      "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("differs when bytes differ", async () => {
    const cwd = await makeRepoFixture({ "a.txt": "one", "b.txt": "two" });
    const a = await sha256OfFile(resolve(cwd, "a.txt"));
    const b = await sha256OfFile(resolve(cwd, "b.txt"));
    expect(a).not.toBe(b);
  });
});

describe("writeLockfile", () => {
  it("sorts installed entries alphabetically by id", async () => {
    const cwd = await makeRepoFixture();
    let lf = upsertLockedEntry(emptyLockfile(), { ...sampleEntry, id: "zebra" });
    lf = upsertLockedEntry(lf, { ...sampleEntry, id: "alpha" });
    lf = upsertLockedEntry(lf, { ...sampleEntry, id: "mango" });
    await writeLockfile(cwd, lf);
    const restored = await readLockfile(cwd);
    expect(restored!.installed.map((e) => e.id)).toEqual([
      "alpha",
      "mango",
      "zebra",
    ]);
  });

  it("readLockfile drops provides whose target is missing", async () => {
    const cwd = await makeRepoFixture();
    const path = lockfilePath(cwd);
    await writeFile(
      path,
      [
        `[[installed]]`,
        `id = "x"`,
        `version = "0.1.0"`,
        `installed_at = "2026-01-01T00:00:00Z"`,
        ``,
        `[[installed.provides]]`,
        `target = ".claude/skills/x.md"`,
        `source = "skills/x.md"`,
        `flavor = "claude"`,
        `checksum = "sha256:abc"`,
        ``,
        `[[installed.provides]]`,
        `# missing target on purpose`,
        `source = "skills/lost.md"`,
        `flavor = "claude"`,
        `checksum = "sha256:def"`,
      ].join("\n"),
    );
    const lf = await readLockfile(cwd);
    expect(lf!.installed[0]!.provides).toHaveLength(1);
    expect(lf!.installed[0]!.provides[0]!.target).toBe(".claude/skills/x.md");
  });
});

describe("lockfile mutation helpers", () => {
  it("upsert replaces an existing entry by id", () => {
    const lf = upsertLockedEntry(emptyLockfile(), sampleEntry);
    const updated = upsertLockedEntry(lf, {
      ...sampleEntry,
      version: "0.3.0",
    });
    expect(updated.installed).toHaveLength(1);
    expect(updated.installed[0]!.version).toBe("0.3.0");
  });

  it("removeLockedEntry drops the matching id", () => {
    const lf = upsertLockedEntry(emptyLockfile(), sampleEntry);
    const after = removeLockedEntry(lf, "commits");
    expect(after.installed).toEqual([]);
  });

  it("findLockedEntry returns undefined when null lockfile", () => {
    expect(findLockedEntry(null, "commits")).toBeUndefined();
  });

  it("findLockedEntry returns the entry by id", () => {
    const lf = upsertLockedEntry(emptyLockfile(), sampleEntry);
    expect(findLockedEntry(lf, "commits")?.version).toBe("0.2.0");
    expect(findLockedEntry(lf, "missing")).toBeUndefined();
  });

  it("findLockedProvide returns the provide by target", () => {
    const provide = findLockedProvide(sampleEntry, ".githooks/commit-msg");
    expect(provide?.checksum).toBe("sha256:def");
  });

  it("findLockedProvide returns undefined for a missing entry", () => {
    expect(findLockedProvide(undefined, ".any/path")).toBeUndefined();
  });

  it("mergeLockedProvides accepts undefined prior", () => {
    const fresh = sampleEntry.provides;
    const merged = mergeLockedProvides(undefined, fresh);
    expect(merged).toHaveLength(fresh.length);
    expect(merged.map((p) => p.target)).toEqual(
      [...fresh.map((p) => p.target)].sort(),
    );
  });

  it("mergeLockedProvides keeps fresh values and drops nothing from prior", () => {
    const prior = sampleEntry.provides;
    const fresh = [
      {
        target: ".claude/skills/commits/skill.md",
        source: "skills/commits/skill.md",
        flavor: "claude" as const,
        checksum: "sha256:NEW",
      },
    ];
    const merged = mergeLockedProvides(prior, fresh);
    const skill = merged.find((p) => p.target.endsWith("skill.md"));
    const hook = merged.find((p) => p.target.endsWith("commit-msg"));
    expect(skill?.checksum).toBe("sha256:NEW");
    expect(hook?.checksum).toBe("sha256:def");
  });
});
