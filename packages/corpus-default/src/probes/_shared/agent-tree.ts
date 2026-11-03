import type {
  AgentConfigEvidence,
  FilesEvidence,
  InstructionFile,
  LinkInfo,
  SizeStatsEvidence,
  SkillFile,
} from "@esbenwiberg/repofit/sdk";

/** Root instruction candidates, in the order `agent_config.guidance` lists them. */
export const ROOT_CANDIDATES = [
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  ".cursorrules",
  ".github/copilot-instructions.md",
] as const;

/** Harness-specific siblings of a canonical `AGENTS.md`, relative to its directory. */
export const HARNESS_SIBLINGS = [
  "CLAUDE.md",
  "GEMINI.md",
  ".cursorrules",
  ".github/copilot-instructions.md",
] as const;

const INCLUDE_LINE_RE = /^@([A-Za-z0-9._/ -]+)$/;

/** The tracked tree as sets, for resolving references without touching disk. */
export type TrackedTree = {
  files: Set<string>;
  dirs: Set<string>;
  has(path: string): boolean;
  hasDir(path: string): boolean;
};

export function trackedTree(size: SizeStatsEvidence, agent: AgentConfigEvidence): TrackedTree {
  const files = new Set<string>();
  for (const f of size.files) files.add(f.path);
  for (const f of agent.instructionFiles) files.add(f.path);
  for (const s of agent.skills) files.add(s.path);
  for (const h of agent.harnessConfig) files.add(h.path);
  const dirs = new Set<string>();
  for (const p of files) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  return {
    files,
    dirs,
    has: (p) => files.has(p),
    hasDir: (p) => p === "" || p === "." || dirs.has(p),
  };
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** `dir/rel` normalised, or `null` when it escapes the repository root. */
export function joinPath(dir: string, rel: string): string | null {
  const parts = dir === "" ? [] : dir.split("/");
  for (const seg of rel.replaceAll("\\", "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join("/");
}

/** Where a link ends up, as a repository path; `null` when it leaves the repository. */
export function linkDestination(linkPath: string, link: LinkInfo): string | null {
  if (!link.insideRepo) return null;
  return joinPath(dirname(linkPath), link.target);
}

/** `@path` include lines parsed from text, as written. */
export function includeLines(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const m = INCLUDE_LINE_RE.exec(line.trim());
    if (m?.[1]) out.push(m[1].trim());
  }
  return out;
}

/** Whether every non-blank line is an `@include`: an adapter that points somewhere else. */
export function isPointer(text: string): boolean {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return lines.length > 0 && lines.every((l) => INCLUDE_LINE_RE.test(l));
}

/** The frontmatter block removed, when the text starts with one. */
export function stripFrontmatter(text: string): string {
  if (!text.startsWith("---")) return text;
  const end = text.indexOf("\n---", 3);
  if (end < 0) return text;
  const after = text.indexOf("\n", end + 1);
  return after < 0 ? "" : text.slice(after + 1);
}

export type RootGuidance = { file: InstructionFile; text: string };

/**
 * The canonical root instruction file: `AGENTS.md` when present, else the
 * largest root candidate that is neither a link nor an include-only pointer.
 */
export async function canonicalRoot(
  agent: AgentConfigEvidence,
  files: FilesEvidence,
): Promise<RootGuidance | null> {
  const roots = agent.instructionFiles.filter(
    (f) => f.depth === 0 && ROOT_CANDIDATES.some((c) => c === f.path),
  );
  const agents = roots.find((f) => f.path === "AGENTS.md");
  if (agents) {
    const text = await readThroughLink(agents, files);
    if (text !== undefined) return { file: agents, text };
  }
  const candidates: RootGuidance[] = [];
  for (const file of roots.filter((f) => f.path !== "AGENTS.md" && !f.link)) {
    const text = await files.readText(file.path);
    if (text === undefined || isPointer(text)) continue;
    candidates.push({ file, text });
  }
  candidates.sort((a, b) => b.file.bytes - a.file.bytes);
  return candidates[0] ?? null;
}

async function readThroughLink(
  file: InstructionFile,
  files: FilesEvidence,
): Promise<string | undefined> {
  const direct = await files.readText(file.path);
  if (direct !== undefined) return direct;
  if (!file.link?.targetExists) return undefined;
  const target = linkDestination(file.path, file.link);
  return target ? files.readText(target) : undefined;
}

/**
 * The text with `@include` lines replaced by the included files, each at most
 * once; what a harness that honours includes actually loads.
 */
export async function resolveIncludes(
  text: string,
  dir: string,
  files: FilesEvidence,
  seen = new Set<string>(),
): Promise<string> {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const m = INCLUDE_LINE_RE.exec(line.trim());
    const target = m?.[1] ? joinPath(dir, m[1].trim()) : null;
    if (!m || target === null) {
      out.push(line);
      continue;
    }
    if (seen.has(target)) continue;
    seen.add(target);
    const included = await files.readText(target);
    if (included === undefined) continue;
    out.push(await resolveIncludes(included, dirname(target), files, seen));
  }
  return out.join("\n");
}

/** The path a skill's `SKILL.md` really lives at, links collapsed onto their targets. */
export function resolvedSkillPath(skill: SkillFile): string {
  if (skill.dirLink) {
    const root = linkDestination(skill.root, skill.dirLink);
    if (root !== null) return `${root}${skill.path.slice(skill.root.length)}`;
  }
  if (skill.link) {
    const linkedDir = linkDestination(skill.dir, skill.link);
    if (linkedDir !== null && skill.link.target !== basename(skill.path)) {
      return `${linkedDir}/SKILL.md`;
    }
    const file = linkDestination(skill.path, skill.link);
    if (file !== null) return file;
  }
  return skill.path;
}

/** Skills deduplicated by resolved path, then by content hash. */
export function distinctSkills(skills: readonly SkillFile[]): SkillFile[] {
  const byPath = new Map<string, SkillFile>();
  for (const skill of skills) {
    const key = resolvedSkillPath(skill);
    const existing = byPath.get(key);
    if (!existing || (existing.link && !skill.link)) byPath.set(key, skill);
  }
  const byHash = new Map<string, SkillFile>();
  for (const skill of byPath.values()) {
    if (!byHash.has(skill.sha256)) byHash.set(skill.sha256, skill);
  }
  return [...byHash.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function skillName(skill: SkillFile): string {
  return skill.frontmatter?.name?.trim() || basename(skill.dir);
}
