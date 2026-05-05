import { describe, expect, it } from "vitest";
import { activeEntries, loadCatalog } from "../../src/catalog.js";
import { makeRepoFixture } from "../helpers/fixtures.js";

interface EntryOverrides {
  version?: string;
  filenameId?: string;
  extraProvides?: Array<{ source: string; target: string }>;
  extra?: string[];
}

function entryToml(
  id: string,
  opts: EntryOverrides = {},
): { filename: string; content: string } {
  const provides = [
    { source: "practices/commits.md", target: `.claude/skills/${id}.md` },
    ...(opts.extraProvides ?? []),
  ];
  const lines: string[] = [
    `id = "${id}"`,
    `name = "X"`,
    `description = "X"`,
    `version = "${opts.version ?? "0.1.0"}"`,
    ``,
  ];
  for (const p of provides) {
    lines.push(
      `[[provides]]`,
      `source = "${p.source}"`,
      `target = "${p.target}"`,
      `flavor = "claude"`,
      `conflict = "prompt"`,
      ``,
    );
  }
  lines.push(`[detect]`, `any_of = [".claude/skills/${id}.md"]`);
  if (opts.extra) lines.push(``, ...opts.extra);
  return {
    filename: `${opts.filenameId ?? id}.toml`,
    content: lines.join("\n"),
  };
}

describe("loadCatalog (real bundled catalog)", () => {
  it("loads at least the kernel entries with no malformed errors", () => {
    const { entries, malformed } = loadCatalog();
    expect(malformed).toEqual([]);
    const ids = entries.map((e) => e.id).sort();
    expect(ids).toContain("commits");
    expect(ids).toContain("code-review");
    expect(ids).toContain("pull-requests");
  });

  it("activeEntries excludes deprecated entries", () => {
    const { entries } = loadCatalog();
    const allIds = new Set(entries.map((e) => e.id));
    const active = activeEntries(entries);
    for (const a of active) {
      expect(a.deprecated_by).toBeUndefined();
    }
    for (const e of entries) {
      if (e.deprecated_by) {
        expect(allIds.has(e.deprecated_by)).toBe(true);
      }
    }
  });
});

describe("loadCatalog (fixture catalog)", () => {
  it("rejects an entry whose id does not match the filename stem", async () => {
    const { filename, content } = entryToml("different", {
      filenameId: "wrong-id",
    });
    const dir = await makeRepoFixture({ [filename]: content });
    const { entries, malformed } = loadCatalog(dir);
    expect(entries).toEqual([]);
    expect(malformed).toHaveLength(1);
    expect(malformed[0]!.errors.some((e) => e.includes("filename stem"))).toBe(true);
  });

  it("rejects an entry whose [[provides]] is missing", async () => {
    const dir = await makeRepoFixture({
      "no-provides.toml": [
        `id = "no-provides"`,
        `name = "X"`,
        `description = "X"`,
        `version = "0.1.0"`,
        ``,
        `[detect]`,
        `any_of = [".claude/skills/x.md"]`,
      ].join("\n"),
    });
    const { entries, malformed } = loadCatalog(dir);
    expect(entries).toEqual([]);
    expect(malformed).toHaveLength(1);
    expect(malformed[0]!.errors.some((e) => e.includes("provides"))).toBe(true);
  });

  it("reports a TOML parse failure as malformed, not a crash", async () => {
    const dir = await makeRepoFixture({
      "broken.toml": "id = ['unterminated\nname = \"oops\"",
    });
    const { entries, malformed } = loadCatalog(dir);
    expect(entries).toEqual([]);
    expect(malformed).toHaveLength(1);
    expect(malformed[0]!.errors[0]).toMatch(/failed to parse TOML/);
  });

  it("rejects a non-semver version string", async () => {
    const { filename, content } = entryToml("bad-version", { version: "v1" });
    const dir = await makeRepoFixture({ [filename]: content });
    const { entries, malformed } = loadCatalog(dir);
    expect(entries).toEqual([]);
    expect(malformed).toHaveLength(1);
    expect(malformed[0]!.errors.some((e) => e.includes("semver"))).toBe(true);
  });

  it("rejects duplicate targets within a single entry", async () => {
    const { filename, content } = entryToml("dup-targets", {
      extraProvides: [
        { source: "practices/commits.md", target: ".claude/skills/dup-targets.md" },
      ],
    });
    const dir = await makeRepoFixture({ [filename]: content });
    const { entries, malformed } = loadCatalog(dir);
    expect(entries).toEqual([]);
    expect(malformed).toHaveLength(1);
    expect(malformed[0]!.errors.some((e) => e.includes("duplicated"))).toBe(true);
  });

  it("rejects a requires.entries reference to an unknown id", async () => {
    const { filename, content } = entryToml("needs-ghost", {
      extra: [`[requires]`, `entries = ["does-not-exist"]`],
    });
    const dir = await makeRepoFixture({ [filename]: content });
    const { entries, malformed } = loadCatalog(dir);
    expect(entries).toEqual([]);
    expect(malformed).toHaveLength(1);
    expect(malformed[0]!.errors.some((e) => e.includes("unknown id"))).toBe(true);
  });

  it("detects cycles in requires.entries", async () => {
    const alpha = entryToml("alpha", {
      extra: [`[requires]`, `entries = ["beta"]`],
    });
    const beta = entryToml("beta", {
      extra: [`[requires]`, `entries = ["alpha"]`],
    });
    const dir = await makeRepoFixture({
      [alpha.filename]: alpha.content,
      [beta.filename]: beta.content,
    });
    const { entries, malformed } = loadCatalog(dir);
    expect(entries).toEqual([]);
    expect(malformed.length).toBeGreaterThanOrEqual(2);
    expect(
      malformed.every((m) => m.errors.some((err) => err.includes("cycle"))),
    ).toBe(true);
  });
});
