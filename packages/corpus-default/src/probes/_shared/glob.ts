/**
 * A gitignore-style glob compiled to a matcher over repository paths.
 *
 * Semantics follow what harness permission rules and instruction tables
 * use in practice: `**` crosses directories, `*` and `?` stay inside one
 * segment, a pattern with no `/` matches a basename at any depth, a pattern
 * that names a directory matches everything under it, and a leading `/`
 * anchors at the base directory. `null` when the pattern reaches outside
 * the repository (`//absolute`, `~/home`).
 */
export type GlobMatcher = {
  /** The pattern as written. */
  pattern: string;
  /** Whether `path` (a repository path) or one of its ancestors matches. */
  test(path: string): boolean;
};

export function compileGlob(pattern: string, base = ""): GlobMatcher | null {
  let p = pattern.trim().replaceAll("\\", "/");
  if (p.length === 0 || p.startsWith("//") || p.startsWith("~")) return null;
  if (p.startsWith("./")) p = p.slice(2);
  const anchored = p.startsWith("/");
  if (anchored) p = p.replace(/^\/+/, "");
  p = p.replace(/\/+$/, "");
  if (p.length === 0) p = "**";
  // A bare basename pattern (`*.gen.ts`, `routeTree.gen.ts`) matches at any depth.
  if (!anchored && !p.includes("/")) p = `**/${p}`;
  const prefix = base === "" ? "" : `${escapeRegex(base)}/`;
  const re = new RegExp(`^${prefix}${globBody(p)}(?:/.*)?$`);
  return { pattern, test: (path) => re.test(path) };
}

function globBody(p: string): string {
  let out = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i] as string;
    if (c === "*") {
      if (p[i + 1] === "*") {
        const after = p[i + 2];
        const before = p[i - 1];
        if ((after === "/" || after === undefined) && (before === "/" || before === undefined)) {
          // `**/` or trailing `**`: zero or more whole segments.
          out += after === "/" ? "(?:.*/)?" : ".*";
          i += after === "/" ? 2 : 1;
          continue;
        }
        out += ".*";
        i += 1;
        continue;
      }
      out += "[^/]*";
      continue;
    }
    if (c === "?") {
      out += "[^/]";
      continue;
    }
    out += escapeRegex(c);
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}
