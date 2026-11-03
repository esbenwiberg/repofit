import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { agentConfigSubsystem } from "../src/evidence/subsystems/agent-config.js";
import { buildAgentConfigEvidence } from "../src/fixtures/agent-config.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
}

function write(root: string, rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

const SKILL = `---
name: commit
description: >
  Use when committing work in this repository; do not use for release tags.
---
# Commit

Body line one.
Body line two.
`;

describe("agent_config subsystem", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "repofit-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("empty directory → no guidance, nothing enumerated", async () => {
    const ev = await agentConfigSubsystem.gather({ cwd: tmp });
    expect(ev.guidance).toHaveLength(0);
    expect(ev.has("CLAUDE.md")).toBe(false);
    expect(ev.instructionFiles).toEqual([]);
    expect(ev.skills).toEqual([]);
    expect(ev.harnessConfig).toEqual([]);
    expect(ev.source).toBe("none");
  });

  test("CLAUDE.md present → found with byte and line count", async () => {
    writeFileSync(join(tmp, "CLAUDE.md"), "# Hello agent\nLine two\nLine three\n");
    const ev = await agentConfigSubsystem.gather({ cwd: tmp });
    expect(ev.guidance).toHaveLength(1);
    expect(ev.guidance[0]?.path).toBe("CLAUDE.md");
    expect(ev.guidance[0]?.bytes).toBeGreaterThan(0);
    expect(ev.guidance[0]?.lines).toBe(3);
    expect(ev.has("CLAUDE.md")).toBe(true);
  });

  test("multiple guidance files all surface", async () => {
    writeFileSync(join(tmp, "CLAUDE.md"), "a");
    writeFileSync(join(tmp, "AGENTS.md"), "b");
    writeFileSync(join(tmp, "GEMINI.md"), "g");
    writeFileSync(join(tmp, ".cursorrules"), "c");
    mkdirSync(join(tmp, ".github"));
    writeFileSync(join(tmp, ".github", "copilot-instructions.md"), "d");
    const ev = await agentConfigSubsystem.gather({ cwd: tmp });
    const paths = ev.guidance.map((g) => g.path).sort();
    expect(paths).toEqual([
      ".cursorrules",
      ".github/copilot-instructions.md",
      "AGENTS.md",
      "CLAUDE.md",
      "GEMINI.md",
    ]);
  });

  test("root guidance stays root-only; nested files land in instructionFiles", async () => {
    write(tmp, "subdir/CLAUDE.md", "x");
    const ev = await agentConfigSubsystem.gather({ cwd: tmp });
    expect(ev.guidance).toHaveLength(0);
    expect(ev.source).toBe("filesystem");
    expect(ev.instructionFiles.map((f) => f.path)).toEqual(["subdir/CLAUDE.md"]);
    expect(ev.instructionFiles[0]?.depth).toBe(1);
  });

  describe("in a git repository with real symlinks", () => {
    beforeEach(() => {
      git(tmp, "init", "-q");
      write(tmp, "AGENTS.md", "# Root\n\nSee docs.\n");
      symlinkSync("AGENTS.md", join(tmp, "CLAUDE.md"));
      write(tmp, "src/AGENTS.md", "# src\n");
      write(tmp, "src/CLAUDE.md", "@AGENTS.md\n");
      write(tmp, ".agents/skills/commit/SKILL.md", SKILL);
      write(tmp, ".agents/skills/commit/evals/cases.json", "[]");
      write(tmp, ".agents/skills/release/SKILL.md", "no frontmatter\n");
      mkdirSync(join(tmp, ".claude"));
      symlinkSync("../.agents/skills", join(tmp, ".claude/skills"));
      write(tmp, ".claude/settings.json", '{"permissions":{"allow":["Bash(npm test)"]}}');
      write(tmp, ".claude/settings.local.json", "{not json");
      write(tmp, ".codex/config.toml", 'model = "x"\n');
      write(tmp, ".cursor/rules/testing.mdc", "rule\n");
      write(tmp, "docs/AGENTS.md", "untracked, must stay invisible\n");
      git(tmp, "add", "-A", "--", ":!docs");
      // A global gitignore commonly excludes local settings; the test needs it tracked.
      git(tmp, "add", "-f", ".claude/settings.local.json");
    });

    test("enumerates instruction files from the index, links resolved", async () => {
      const ev = await agentConfigSubsystem.gather({ cwd: tmp });
      expect(ev.source).toBe("git-ls-files");
      expect(ev.instructionFiles.map((f) => f.path)).toEqual([
        ".cursor/rules/testing.mdc",
        "AGENTS.md",
        "CLAUDE.md",
        "src/AGENTS.md",
        "src/CLAUDE.md",
      ]);
      const root = ev.instructionFiles.find((f) => f.path === "AGENTS.md");
      const alias = ev.instructionFiles.find((f) => f.path === "CLAUDE.md");
      expect(root?.link).toBeNull();
      expect(alias?.link).toEqual({ target: "AGENTS.md", targetExists: true, insideRepo: true });
      expect(alias?.sha256).toBe(root?.sha256);
      expect(alias?.bytes).toBe(root?.bytes);
      const pointer = ev.instructionFiles.find((f) => f.path === "src/CLAUDE.md");
      expect(pointer?.includes).toEqual(["AGENTS.md"]);
      expect(pointer?.depth).toBe(1);
    });

    test("skills: direct entries plus those reached through the linked root", async () => {
      const ev = await agentConfigSubsystem.gather({ cwd: tmp });
      expect(ev.skills.map((s) => s.path)).toEqual([
        ".agents/skills/commit/SKILL.md",
        ".agents/skills/release/SKILL.md",
        ".claude/skills/commit/SKILL.md",
        ".claude/skills/release/SKILL.md",
      ]);
      const commit = ev.skills.find((s) => s.path === ".agents/skills/commit/SKILL.md");
      expect(commit).toMatchObject({
        dir: ".agents/skills/commit",
        root: ".agents/skills",
        link: null,
        dirLink: null,
        hasEvals: true,
        hasReferences: false,
        bodyLines: 4,
      });
      expect(commit?.frontmatter?.name).toBe("commit");
      expect(commit?.frontmatter?.description).toBe(
        "Use when committing work in this repository; do not use for release tags.",
      );
      const release = ev.skills.find((s) => s.path === ".agents/skills/release/SKILL.md");
      expect(release?.frontmatter).toBeNull();
      expect(release?.bodyLines).toBe(1);
      const mirrored = ev.skills.find((s) => s.path === ".claude/skills/commit/SKILL.md");
      expect(mirrored).toMatchObject({
        dir: ".claude/skills/commit",
        root: ".claude/skills",
        link: null,
        dirLink: { target: "../.agents/skills", targetExists: true, insideRepo: true },
        hasEvals: true,
        sha256: commit?.sha256,
      });
    });

    test("harness config: JSON parsed, invalid JSON recorded, other formats raw", async () => {
      const ev = await agentConfigSubsystem.gather({ cwd: tmp });
      expect(ev.harnessConfig.map((h) => h.path)).toEqual([
        ".claude/settings.json",
        ".claude/settings.local.json",
        ".codex/config.toml",
      ]);
      const [settings, local, codex] = ev.harnessConfig;
      expect(settings?.json).toEqual({ permissions: { allow: ["Bash(npm test)"] } });
      expect(settings?.parseError).toBeNull();
      expect(local?.json).toBeNull();
      expect(local?.parseError).toMatch(/JSON/);
      expect(codex?.json).toBeNull();
      expect(codex?.parseError).toBeNull();
    });

    test("untracked files are invisible", async () => {
      const ev = await agentConfigSubsystem.gather({ cwd: tmp });
      expect(ev.instructionFiles.some((f) => f.path === "docs/AGENTS.md")).toBe(false);
    });

    test("core.symlinks=false checkout: the index still says link, the text file gives the target", async () => {
      git(tmp, "commit", "-qm", "init");
      git(tmp, "config", "core.symlinks", "false");
      rmSync(join(tmp, "CLAUDE.md"));
      git(tmp, "checkout", "--", "CLAUDE.md");
      const ev = await agentConfigSubsystem.gather({ cwd: tmp });
      const alias = ev.instructionFiles.find((f) => f.path === "CLAUDE.md");
      expect(alias?.link).toEqual({ target: "AGENTS.md", targetExists: true, insideRepo: true });
      const root = ev.instructionFiles.find((f) => f.path === "AGENTS.md");
      expect(alias?.sha256).toBe(root?.sha256);
    });
  });

  test("a link pointing outside the repository is neither inside nor existing", async () => {
    const outside = mkdtempSync(join(tmpdir(), "repofit-outside-"));
    try {
      writeFileSync(join(outside, "AGENTS.md"), "elsewhere\n");
      git(tmp, "init", "-q");
      symlinkSync(join(outside, "AGENTS.md"), join(tmp, "CLAUDE.md"));
      write(tmp, "AGENTS.md", "root\n");
      git(tmp, "add", "-A");
      const ev = await agentConfigSubsystem.gather({ cwd: tmp });
      const alias = ev.instructionFiles.find((f) => f.path === "CLAUDE.md");
      expect(alias?.link?.insideRepo).toBe(false);
      expect(alias?.link?.targetExists).toBe(false);
      expect(alias?.bytes).toBe(0);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("a relative link escaping the root is treated the same", async () => {
    git(tmp, "init", "-q");
    symlinkSync("../somewhere/AGENTS.md", join(tmp, "CLAUDE.md"));
    git(tmp, "add", "-A");
    const ev = await agentConfigSubsystem.gather({ cwd: tmp });
    expect(ev.instructionFiles[0]?.link).toEqual({
      target: "../somewhere/AGENTS.md",
      targetExists: false,
      insideRepo: false,
    });
  });

  test("a dangling link inside the repository exists nowhere but is inside", async () => {
    git(tmp, "init", "-q");
    symlinkSync("MISSING.md", join(tmp, "CLAUDE.md"));
    git(tmp, "add", "-A");
    const ev = await agentConfigSubsystem.gather({ cwd: tmp });
    expect(ev.instructionFiles[0]?.link).toEqual({
      target: "MISSING.md",
      targetExists: false,
      insideRepo: true,
    });
    expect(ev.instructionFiles[0]?.lines).toBe(0);
  });

  test("a linked skill directory is read through the link", async () => {
    git(tmp, "init", "-q");
    write(tmp, ".agents/skills/commit/SKILL.md", SKILL);
    write(tmp, ".agents/skills/commit/references/style.md", "# style\n");
    mkdirSync(join(tmp, ".claude/skills"), { recursive: true });
    symlinkSync("../../.agents/skills/commit", join(tmp, ".claude/skills/commit"));
    git(tmp, "add", "-A");
    const ev = await agentConfigSubsystem.gather({ cwd: tmp });
    const linked = ev.skills.find((s) => s.path === ".claude/skills/commit/SKILL.md");
    expect(linked).toMatchObject({
      dir: ".claude/skills/commit",
      root: ".claude/skills",
      link: { target: "../../.agents/skills/commit", targetExists: true, insideRepo: true },
      dirLink: null,
      hasReferences: true,
    });
    expect(linked?.frontmatter?.name).toBe("commit");
    expect(linked?.sha256).toBe(ev.skills.find((s) => s.root === ".agents/skills")?.sha256);
  });

  test("without git metadata the filesystem walk uses lstat for links", async () => {
    write(tmp, "AGENTS.md", "root\n");
    symlinkSync("AGENTS.md", join(tmp, "CLAUDE.md"));
    write(tmp, "node_modules/pkg/AGENTS.md", "must be skipped\n");
    const ev = await agentConfigSubsystem.gather({ cwd: tmp });
    expect(ev.source).toBe("filesystem");
    expect(ev.instructionFiles.map((f) => f.path)).toEqual(["AGENTS.md", "CLAUDE.md"]);
    expect(ev.instructionFiles[1]?.link).toEqual({
      target: "AGENTS.md",
      targetExists: true,
      insideRepo: true,
    });
  });

  test("frontmatter: quoted scalars parse, an unclosed block is null", async () => {
    write(
      tmp,
      ".codex/skills/review/SKILL.md",
      "---\nname: \"review\"\ndescription: 'Use when reviewing.'\nextra: 3\n---\nbody\n",
    );
    write(tmp, ".codex/skills/broken/SKILL.md", "---\nname: broken\nbody without close\n");
    const ev = await agentConfigSubsystem.gather({ cwd: tmp });
    const review = ev.skills.find((s) => s.dir === ".codex/skills/review");
    expect(review?.frontmatter).toEqual({
      name: "review",
      description: "Use when reviewing.",
      raw: { name: "review", description: "Use when reviewing.", extra: "3" },
    });
    expect(review?.bodyLines).toBe(1);
    const broken = ev.skills.find((s) => s.dir === ".codex/skills/broken");
    expect(broken?.frontmatter).toBeNull();
    expect(broken?.bodyLines).toBe(3);
  });
});

describe("buildAgentConfigEvidence", () => {
  test("classifies an in-memory tree like a checkout, links included", () => {
    const ev = buildAgentConfigEvidence({
      files: {
        "AGENTS.md": "# Root\n\n@docs/extra.md\n",
        "docs/extra.md": "more\n",
        "src/CLAUDE.md": "@AGENTS.md\n",
        ".agents/skills/commit/SKILL.md":
          "---\nname: commit\ndescription: >\n  Use when committing.\n---\nbody\n",
        ".agents/skills/commit/evals/case.md": "x",
        ".claude/settings.json": '{"a":1}',
        ".claude/settings.local.json": "{broken",
      },
      links: { "CLAUDE.md": "AGENTS.md", ".claude/skills": "../.agents/skills" },
    });
    expect(ev.source).toBe("git-ls-files");
    expect(ev.guidance.map((g) => g.path).sort()).toEqual(["AGENTS.md", "CLAUDE.md"]);
    expect(ev.has("CLAUDE.md")).toBe(true);
    const claude = ev.instructionFiles.find((f) => f.path === "CLAUDE.md");
    const root = ev.instructionFiles.find((f) => f.path === "AGENTS.md");
    expect(claude?.link).toEqual({ target: "AGENTS.md", targetExists: true, insideRepo: true });
    expect(claude?.sha256).toBe(root?.sha256);
    expect(root?.includes).toEqual(["docs/extra.md"]);
    expect(ev.instructionFiles.find((f) => f.path === "src/CLAUDE.md")?.includes).toEqual([
      "AGENTS.md",
    ]);
    expect(ev.skills.map((s) => s.path)).toEqual([
      ".agents/skills/commit/SKILL.md",
      ".claude/skills/commit/SKILL.md",
    ]);
    expect(ev.skills[0]?.frontmatter?.description).toBe("Use when committing.");
    expect(ev.skills[0]?.hasEvals).toBe(true);
    expect(ev.skills[1]?.dirLink?.targetExists).toBe(true);
    expect(ev.harnessConfig.map((h) => [h.path, h.json, h.parseError !== null])).toEqual([
      [".claude/settings.json", { a: 1 }, false],
      [".claude/settings.local.json", null, true],
    ]);
  });

  test("a dangling root link does not count as root guidance", () => {
    const ev = buildAgentConfigEvidence({ files: {}, links: { "CLAUDE.md": "AGENTS.md" } });
    expect(ev.guidance).toEqual([]);
    expect(ev.instructionFiles[0]?.link?.targetExists).toBe(false);
  });
});
