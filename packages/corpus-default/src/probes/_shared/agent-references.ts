import type { SkillFile } from "@esbenwiberg/repofit/sdk";
import { basename, joinPath, skillName, type TrackedTree } from "./agent-tree.js";

export type Reference = {
  kind: "link" | "path" | "skill" | "include";
  /** The target as written. */
  target: string;
  line: number;
  /** The line says not to use the target ("no `CHANGELOG.md`", "instead of `x`"). */
  negated: boolean;
};

const NEGATION_RE =
  /\b(?:no|not|never|don'?t|do not|avoid|without|instead of|rather than|tempted to|deprecated|removed|obsolete)\b/i;

const MD_LINK_RE = /!?\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const BACKTICK_RE = /`([^`\n]+)`/g;
const INCLUDE_RE = /^@([A-Za-z0-9._/ -]+)$/;
const PATH_TOKEN_RE = /^\.{0,2}\/?[A-Za-z0-9_@][A-Za-z0-9_.@/-]*\/?$/;
const SKILL_TOKEN_RE = /^\/([a-z0-9][a-z0-9-]*)$/;
const TEMPLATE_RE = /[<>*{}]/;
const UNTRACKED_PREFIX_RE = /^(?:\.\/)?(?:node_modules|dist|build)(?:\/|$)/;

function isUrl(s: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(s);
}

/** Repository-internal references in instruction text, with the line they sit on. */
export function extractReferences(text: string): Reference[] {
  const out: Reference[] = [];
  const lines = text.split("\n");
  for (const [i, raw] of lines.entries()) {
    const line = i + 1;
    const negated =
      NEGATION_RE.test(raw) ||
      (continuesPrevious(lines, i) && NEGATION_RE.test(lines[i - 1] ?? ""));
    const include = INCLUDE_RE.exec(raw.trim());
    if (include?.[1]) {
      out.push({ kind: "include", target: include[1].trim(), line, negated: false });
      continue;
    }
    for (const m of raw.matchAll(MD_LINK_RE)) {
      const href = m[1] ?? "";
      if (isUrl(href) || href.startsWith("#")) continue;
      out.push({ kind: "link", target: href, line, negated });
    }
    for (const m of raw.matchAll(BACKTICK_RE)) {
      const token = (m[1] ?? "").trim();
      const skill = SKILL_TOKEN_RE.exec(token);
      if (skill?.[1]) {
        out.push({ kind: "skill", target: skill[1], line, negated });
        continue;
      }
      if (looksLikePath(token)) out.push({ kind: "path", target: token, line, negated });
    }
  }
  return out;
}

/** Hard-wrapped prose: this line continues the previous sentence rather than starting an item. */
function continuesPrevious(lines: readonly string[], i: number): boolean {
  const prev = lines[i - 1];
  const cur = lines[i] ?? "";
  if (prev === undefined || prev.trim() === "") return false;
  return !/^\s*(?:[-*+]\s|\d+[.)]\s|#|\||```)/.test(cur);
}

function looksLikePath(token: string): boolean {
  if (!PATH_TOKEN_RE.test(token) || isUrl(token)) return false;
  if (token.startsWith("-")) return false;
  const bare = token.replace(/\/$/, "");
  // A single word without a slash or an extension is prose, not a path.
  return bare.includes("/") || /\.[A-Za-z0-9]{1,8}$/.test(bare) || /^\.[A-Za-z]/.test(bare);
}

export function isTemplate(target: string): boolean {
  return TEMPLATE_RE.test(target);
}

export function isUntrackedByDesign(target: string): boolean {
  return UNTRACKED_PREFIX_RE.test(target);
}

/** Strip a `#fragment` and a `?query` from a markdown link target. */
export function targetPath(target: string): string {
  const cut = target.search(/[#?]/);
  return cut < 0 ? target : target.slice(0, cut);
}

export type Resolution = "resolves" | "blind" | "unknown";

/**
 * Resolve a path reference from `dir`, falling back to the repository root
 * because instruction files routinely write root-relative paths. `blind`
 * means the parent directory exists but the target does not; `unknown`
 * means not even the parent exists, which is a documentation example more
 * often than a pointer. A bare file name without a directory (`index.ts`,
 * `.ts`, `lint.clean`) names a kind of file as often as a file, so it either
 * resolves or stays `unknown`; only a target with a directory part can be
 * `blind`.
 */
export function resolvePathReference(
  target: string,
  dir: string,
  tree: TrackedTree,
): { resolution: Resolution; path: string | null } {
  const rel = targetPath(target).replace(/\/$/, "");
  if (rel.length === 0) return { resolution: "resolves", path: dir };
  const candidates = [joinPath(dir, rel), dir === "" ? null : joinPath("", rel)].filter(
    (p): p is string => p !== null,
  );
  for (const p of candidates) {
    if (tree.has(p) || tree.hasDir(p)) return { resolution: "resolves", path: p };
  }
  const first = candidates[0];
  if (first === undefined || !rel.includes("/"))
    return { resolution: "unknown", path: first ?? null };
  const parentExists = candidates.some((p) => tree.hasDir(parentOf(p)));
  return { resolution: parentExists ? "blind" : "unknown", path: first };
}

function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

export function skillNames(skills: readonly SkillFile[]): Set<string> {
  const names = new Set<string>();
  for (const s of skills) {
    names.add(skillName(s));
    names.add(basename(s.dir));
  }
  return names;
}
