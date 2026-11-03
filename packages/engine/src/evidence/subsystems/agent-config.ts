import { createHash } from "node:crypto";
import { readdir, readFile, readlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { dirname, normalize as normalizePosix } from "node:path/posix";
import type {
  AgentConfigEvidence,
  GatherContext,
  GuidanceFile,
  HarnessConfigFile,
  InstructionFile,
  LinkInfo,
  SkillFile,
  SkillFrontmatter,
} from "../../sdk/types.js";
import { countLines } from "../../util/count-lines.js";
import { listTrackedEntries } from "../../util/git.js";

const GUIDANCE_CANDIDATES = [
  "CLAUDE.md",
  "AGENTS.md",
  "GEMINI.md",
  ".cursorrules",
  ".aider.conf.yml",
  ".github/copilot-instructions.md",
] as const;

/** Per-file read cap; `bytes` still reports the real size. */
const READ_CAP = 256 * 1024;
/** Enumeration cap for the no-git filesystem walk, matching `size_stats`. */
const WALK_LIMIT = 5000;
const WALK_SKIP = new Set(["node_modules", ".git", "dist", "build", "target", "vendor", ".venv"]);
const MAX_LINK_HOPS = 8;
const SYMLINK_MODE = "120000";

const INSTRUCTION_BASENAMES = new Set(["agents.md", "claude.md", "gemini.md"]);
const INSTRUCTION_PATTERNS: readonly RegExp[] = [
  /(^|\/)\.cursorrules$/,
  /(^|\/)\.aider\.conf\.yml$/,
  /(^|\/)\.github\/copilot-instructions\.md$/,
  /(^|\/)\.github\/instructions\/[^/]+\.md$/,
  /(^|\/)\.cursor\/rules\/[^/]+\.mdc?$/,
  /(^|\/)\.claude\/rules\/[^/]+\.md$/,
];
const HARNESS_CONFIG_PATTERNS: readonly RegExp[] = [
  /(^|\/)\.claude\/settings(\.[^/]+)?\.json$/,
  /(^|\/)\.codex\/[^/]+$/,
  /(^|\/)\.gemini\/settings(\.[^/]+)?\.json$/,
  /(^|\/)\.cursor\/hooks\.json$/,
  /(^|\/)\.cursor\/settings(\.[^/]+)?\.json$/,
];
const SKILL_PATH_RE = /^(?:(.*)\/)?([^/]+)\/([^/]+)\/SKILL\.md$/;
const INCLUDE_LINE_RE = /^@([A-Za-z0-9._/ -]+)$/;

type Entry = { path: string; isLink: boolean };
type Tree = {
  entries: Entry[];
  paths: Set<string>;
  /** Directories implied by tracked paths (`a/b/c.md` implies `a` and `a/b`). */
  dirs: Set<string>;
  links: Map<string, string | null>;
};

export const agentConfigSubsystem = {
  async gather(ctx: GatherContext): Promise<AgentConfigEvidence> {
    const root = ctx.cwd;
    const guidance = await readRootGuidance(root);
    const present = new Set(guidance.map((g) => g.path));

    const tracked = await listTrackedEntries(root);
    const source: AgentConfigEvidence["source"] = tracked === null ? "filesystem" : "git-ls-files";
    const base: Entry[] =
      tracked === null
        ? await walkFilesystem(root)
        : tracked
            .filter((e) => e.mode !== "160000")
            .map((e) => ({ path: e.path, isLink: e.mode === SYMLINK_MODE }));
    const tree = await buildTree(root, base);

    const [instructionFiles, skills, harnessConfig] = await Promise.all([
      gatherInstructionFiles(root, tree),
      gatherSkills(root, tree),
      gatherHarnessConfig(root, tree),
    ]);

    return {
      guidance,
      has(path: string): boolean {
        return present.has(path);
      },
      instructionFiles,
      skills,
      harnessConfig,
      source: base.length === 0 && tracked === null ? "none" : source,
    };
  },
};

async function readRootGuidance(root: string): Promise<GuidanceFile[]> {
  const found = await Promise.all(
    GUIDANCE_CANDIDATES.map(async (name): Promise<GuidanceFile | null> => {
      const full = join(root, name);
      try {
        const [s, content] = await Promise.all([stat(full), readFile(full, "utf8")]);
        return { path: name, bytes: s.size, lines: countLines(content) };
      } catch {
        return null;
      }
    }),
  );
  return found.filter((g): g is GuidanceFile => g !== null);
}

// ---------------------------------------------------------------------------
// Tree enumeration and links

async function walkFilesystem(root: string): Promise<Entry[]> {
  const out: Entry[] = [];
  const queue: string[] = [""];
  while (queue.length > 0 && out.length < WALK_LIMIT) {
    const rel = queue.shift() as string;
    let names: import("node:fs").Dirent[];
    try {
      names = await readdir(rel === "" ? root : join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of names) {
      const p = rel === "" ? d.name : `${rel}/${d.name}`;
      if (d.isSymbolicLink()) out.push({ path: p, isLink: true });
      else if (d.isDirectory()) {
        if (!WALK_SKIP.has(d.name)) queue.push(p);
      } else if (d.isFile()) out.push({ path: p, isLink: false });
      if (out.length >= WALK_LIMIT) break;
    }
  }
  return out;
}

async function buildTree(root: string, entries: Entry[]): Promise<Tree> {
  const paths = new Set(entries.map((e) => e.path));
  const dirs = new Set<string>();
  for (const p of paths) {
    let d = dirname(p);
    while (d !== "." && d !== "/" && !dirs.has(d)) {
      dirs.add(d);
      d = dirname(d);
    }
  }
  const links = new Map<string, string | null>();
  await Promise.all(
    entries
      .filter((e) => e.isLink)
      .map(async (e) => {
        links.set(e.path, await readLinkTarget(root, e.path));
      }),
  );
  return { entries, paths, dirs, links };
}

/**
 * The link target as written. A real symlink answers `readlink`; on a
 * `core.symlinks=false` checkout the working tree holds the target as the
 * file's text, which is what the index blob contains too.
 */
async function readLinkTarget(root: string, path: string): Promise<string | null> {
  const full = join(root, path);
  try {
    return await readlink(full);
  } catch {
    try {
      const text = await readFile(full, "utf8");
      const line = text.split(/\r?\n/)[0]?.trim() ?? "";
      return line.length > 0 && line.length < 4096 ? line : null;
    } catch {
      return null;
    }
  }
}

function isAbsoluteTarget(target: string): boolean {
  return target.startsWith("/") || /^[A-Za-z]:[\\/]/.test(target) || target.startsWith("\\\\");
}

/** Resolve `target` relative to `linkPath`'s directory; `null` when it escapes the repo. */
function resolveTarget(linkPath: string, target: string): string | null {
  if (isAbsoluteTarget(target)) return null;
  const dir = dirname(linkPath);
  const joined = normalizePosix(dir === "." ? target : `${dir}/${target.replace(/\\/g, "/")}`);
  if (joined === ".." || joined.startsWith("../") || joined.startsWith("/")) return null;
  return joined === "." ? "" : joined.replace(/\/$/, "");
}

function existsInTree(tree: Tree, path: string): boolean {
  return tree.paths.has(path) || tree.dirs.has(path);
}

function linkInfo(tree: Tree, linkPath: string): LinkInfo {
  const target = tree.links.get(linkPath) ?? "";
  const resolved = resolveTarget(linkPath, target);
  if (resolved === null) return { target, targetExists: false, insideRepo: false };
  return {
    target,
    targetExists: existsInTree(tree, finalTarget(tree, resolved)),
    insideRepo: true,
  };
}

/** Follow link chains (bounded) so a link to a link lands on the real path. */
function finalTarget(tree: Tree, path: string): string {
  let current = path;
  for (let hop = 0; hop < MAX_LINK_HOPS; hop += 1) {
    const next = tree.links.get(current);
    if (next === undefined) return current;
    const resolved = resolveTarget(current, next ?? "");
    if (resolved === null) return current;
    current = resolved;
  }
  return current;
}

/** The on-disk-or-linked path to read for `path`, honouring link chains inside the repo. */
function readablePath(tree: Tree, path: string): string | null {
  const target = tree.links.has(path) ? finalTarget(tree, path) : path;
  if (tree.links.has(target)) return null;
  return tree.paths.has(target) ? target : null;
}

type Content = { bytes: number; text: string; sha256: string };

async function readContent(root: string, tree: Tree, path: string): Promise<Content | null> {
  const real = readablePath(tree, path);
  if (real === null) return null;
  const full = join(root, real);
  try {
    const s = await stat(full);
    if (!s.isFile()) return null;
    const buffer = await readFile(full);
    const slice = buffer.byteLength > READ_CAP ? buffer.subarray(0, READ_CAP) : buffer;
    return {
      bytes: s.size,
      text: slice.toString("utf8"),
      sha256: createHash("sha256").update(slice).digest("hex"),
    };
  } catch {
    return null;
  }
}

const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");

// ---------------------------------------------------------------------------
// Instruction files

function isInstructionPath(path: string): boolean {
  const slash = path.lastIndexOf("/");
  const base = slash < 0 ? path : path.slice(slash + 1);
  if (INSTRUCTION_BASENAMES.has(base.toLowerCase())) return true;
  return INSTRUCTION_PATTERNS.some((re) => re.test(path));
}

async function gatherInstructionFiles(root: string, tree: Tree): Promise<InstructionFile[]> {
  const candidates = tree.entries.filter((e) => isInstructionPath(e.path));
  const files = await Promise.all(
    candidates.map(async (e): Promise<InstructionFile> => {
      const link = e.isLink ? linkInfo(tree, e.path) : null;
      const content = await readContent(root, tree, e.path);
      const text = content?.text ?? "";
      return {
        path: e.path,
        depth: e.path.split("/").length - 1,
        bytes: content?.bytes ?? 0,
        lines: countLines(text),
        sha256: content?.sha256 ?? EMPTY_SHA256,
        link,
        includes: parseIncludes(text),
      };
    }),
  );
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function parseIncludes(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = INCLUDE_LINE_RE.exec(raw.trim());
    if (m?.[1]) out.push(m[1].trim());
  }
  return out;
}

// ---------------------------------------------------------------------------
// Skills

type SkillLocation = { path: string; dir: string; root: string };

function parseSkillPath(path: string): SkillLocation | null {
  const m = SKILL_PATH_RE.exec(path);
  if (!m) return null;
  const prefix = m[1] ? `${m[1]}/` : "";
  const root = `${prefix}${m[2]}`;
  const dir = `${root}/${m[3]}`;
  return { path, dir, root };
}

function isSkillsRoot(root: string): boolean {
  return /(^|\/)skills$/.test(root);
}

async function gatherSkills(root: string, tree: Tree): Promise<SkillFile[]> {
  const direct = new Map<string, SkillLocation>();
  for (const e of tree.entries) {
    const loc = parseSkillPath(e.path);
    if (loc && isSkillsRoot(loc.root)) direct.set(e.path, loc);
  }

  // A skill directory that is itself a link (`.claude/skills/x -> ../../.agents/skills/x`)
  // lists as one entry; its SKILL.md is reachable through the link.
  const viaDirLink: Array<{ loc: SkillLocation; dirLinkPath: string }> = [];
  // A skills root that is a link (`.claude/skills -> .agents/skills`) lists as one entry;
  // every skill under its target is reachable through it.
  const viaRootLink: Array<{ loc: SkillLocation; rootLinkPath: string; targetRoot: string }> = [];
  for (const [linkPath, target] of tree.links) {
    const resolved = target === null ? null : resolveTarget(linkPath, target);
    if (resolved === null) {
      if (isSkillsRoot(dirname(linkPath))) {
        viaDirLink.push({
          loc: { path: `${linkPath}/SKILL.md`, dir: linkPath, root: dirname(linkPath) },
          dirLinkPath: linkPath,
        });
      }
      continue;
    }
    const final = finalTarget(tree, resolved);
    if (isSkillsRoot(linkPath) && tree.dirs.has(final)) {
      for (const loc of direct.values()) {
        if (loc.root === final) {
          const name = loc.dir.slice(loc.root.length + 1);
          viaRootLink.push({
            loc: {
              path: `${linkPath}/${name}/SKILL.md`,
              dir: `${linkPath}/${name}`,
              root: linkPath,
            },
            rootLinkPath: linkPath,
            targetRoot: final,
          });
        }
      }
    } else if (isSkillsRoot(dirname(linkPath)) && !direct.has(linkPath)) {
      viaDirLink.push({
        loc: { path: `${linkPath}/SKILL.md`, dir: linkPath, root: dirname(linkPath) },
        dirLinkPath: linkPath,
      });
    }
  }

  const describe = async (
    loc: SkillLocation,
    opts: {
      readPath: string;
      link: LinkInfo | null;
      dirLink: LinkInfo | null;
      dirForAssets: string;
    },
  ): Promise<SkillFile> => {
    const content = await readContent(root, tree, opts.readPath);
    const text = content?.text ?? "";
    const { frontmatter, bodyLines } = parseFrontmatter(text);
    return {
      path: loc.path,
      dir: loc.dir,
      root: loc.root,
      frontmatter,
      bodyLines,
      sha256: content?.sha256 ?? EMPTY_SHA256,
      link: opts.link,
      dirLink: opts.dirLink,
      hasEvals: hasFilesUnder(tree, `${opts.dirForAssets}/evals`),
      hasReferences: hasFilesUnder(tree, `${opts.dirForAssets}/references`),
    };
  };

  const skills = await Promise.all([
    ...[...direct.values()].map((loc) => {
      const entryIsLink = tree.links.has(loc.path);
      return describe(loc, {
        readPath: loc.path,
        link: entryIsLink ? linkInfo(tree, loc.path) : null,
        dirLink: null,
        dirForAssets: loc.dir,
      });
    }),
    ...viaDirLink.map(({ loc, dirLinkPath }) => {
      const info = linkInfo(tree, dirLinkPath);
      const targetDir = info.insideRepo
        ? finalTarget(tree, resolveTarget(dirLinkPath, info.target) ?? "")
        : "";
      return describe(loc, {
        readPath: targetDir ? `${targetDir}/SKILL.md` : loc.path,
        link: info,
        dirLink: null,
        dirForAssets: targetDir || loc.dir,
      });
    }),
    ...viaRootLink.map(({ loc, rootLinkPath, targetRoot }) => {
      const name = loc.dir.slice(loc.root.length + 1);
      return describe(loc, {
        readPath: `${targetRoot}/${name}/SKILL.md`,
        link: null,
        dirLink: linkInfo(tree, rootLinkPath),
        dirForAssets: `${targetRoot}/${name}`,
      });
    }),
  ]);
  return skills.sort((a, b) => a.path.localeCompare(b.path));
}

function hasFilesUnder(tree: Tree, dir: string): boolean {
  if (!tree.dirs.has(dir)) return false;
  const prefix = `${dir}/`;
  for (const p of tree.paths) if (p.startsWith(prefix)) return true;
  return false;
}

/**
 * The YAML block between the first two `---` lines. Only top-level `key: value`
 * scalars are interpreted (quoted or bare, with `>`/`|` folded blocks joined);
 * anything else stays raw as its source text.
 */
function parseFrontmatter(text: string): {
  frontmatter: SkillFrontmatter | null;
  bodyLines: number;
} {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { frontmatter: null, bodyLines: countLines(text) };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return { frontmatter: null, bodyLines: countLines(text) };
  const raw: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let folded: string[] | null = null;
  const flush = () => {
    if (currentKey !== null && folded !== null) raw[currentKey] = folded.join(" ").trim();
    currentKey = null;
    folded = null;
  };
  for (const line of lines.slice(1, end)) {
    if (folded !== null && /^\s+\S/.test(line)) {
      folded.push(line.trim());
      continue;
    }
    flush();
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!m?.[1]) continue;
    const key = m[1];
    const value = (m[2] ?? "").trim();
    if (value === ">" || value === "|" || value === ">-" || value === "|-" || value === "") {
      currentKey = key;
      folded = [];
      continue;
    }
    raw[key] = unquote(value);
  }
  flush();
  const name = typeof raw.name === "string" ? raw.name : undefined;
  const description = typeof raw.description === "string" ? raw.description : undefined;
  const body = lines.slice(end + 1).join("\n");
  return {
    frontmatter: {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      raw,
    },
    bodyLines: countLines(body),
  };
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    if ((first === '"' || first === "'") && value.endsWith(first)) return value.slice(1, -1);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Harness configuration

async function gatherHarnessConfig(root: string, tree: Tree): Promise<HarnessConfigFile[]> {
  const candidates = tree.entries.filter((e) =>
    HARNESS_CONFIG_PATTERNS.some((re) => re.test(e.path)),
  );
  const files = await Promise.all(
    candidates.map(async (e): Promise<HarnessConfigFile> => {
      const link = e.isLink ? linkInfo(tree, e.path) : null;
      const content = await readContent(root, tree, e.path);
      if (!e.path.endsWith(".json") || content === null) {
        return { path: e.path, link, json: null, parseError: null };
      }
      try {
        return { path: e.path, link, json: JSON.parse(content.text) as unknown, parseError: null };
      } catch (err) {
        return {
          path: e.path,
          link,
          json: null,
          parseError: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
