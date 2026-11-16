import { createHash } from "node:crypto";
import { lstat, mkdir, opendir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { exec } from "../../util/exec.js";
import { extract } from "./adapters.js";
import { type FileFacts, INDEX_VERSION, type StructuralIndex } from "./types.js";

const EXCLUDED =
  /(?:^|\/)(?:node_modules|\.git|\.repofit|dist|build|bin|obj|coverage|vendor)(?:\/|$)|(?:\.generated\.|\.g\.(?:cs|ts)$)/i;
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export async function safeReadBytes(cwd: string, path: string, maxBytes = 262144): Promise<Buffer> {
  const root = await realpath(cwd);
  const absolute = await realpath(resolve(cwd, path));
  if (!absolute.startsWith(root + sep)) throw new Error(`path outside repository: ${path}`);
  const info = await lstat(absolute);
  if (!info.isFile() || info.size > maxBytes)
    throw new Error(`not a bounded regular file: ${path}`);
  return readFile(absolute);
}
export async function safeRead(cwd: string, path: string, maxBytes = 262144): Promise<string> {
  return (await safeReadBytes(cwd, path, maxBytes)).toString("utf8");
}
export async function loadIndex(cwd: string): Promise<StructuralIndex | undefined> {
  try {
    const raw = JSON.parse(
      await safeRead(cwd, ".repofit/cache/structural-index.json", 64 * 1024 * 1024),
    ) as StructuralIndex;
    const strings = (v: unknown, max: number) =>
      Array.isArray(v) &&
      v.length <= max &&
      v.every((x) => typeof x === "string" && x.length <= 4096);
    const line = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v > 0;
    const valid =
      raw?.version === INDEX_VERSION &&
      raw.files &&
      typeof raw.files === "object" &&
      !Array.isArray(raw.files) &&
      Object.keys(raw.files).length <= 10000 &&
      Array.isArray(raw.manifest) &&
      raw.manifest.every(
        (e) =>
          e &&
          typeof e.path === "string" &&
          ["included", "excluded", "unparsed", "truncated"].includes(e.status),
      ) &&
      Object.entries(raw.files).every(
        ([path, f]) =>
          f &&
          f.path === path &&
          typeof f.hash === "string" &&
          /^[a-f0-9]{64}$/.test(f.hash) &&
          typeof f.stamp === "string" &&
          f.stamp.length < 256 &&
          ["typescript", "csharp", "documentation", "configuration"].includes(f.adapter) &&
          typeof f.contracts === "boolean" &&
          Array.isArray(f.imports) &&
          f.imports.length <= 512 &&
          f.imports.every((v) => v && typeof v.name === "string" && line(v.line)) &&
          Array.isArray(f.texts) &&
          f.texts.length <= 256 &&
          f.texts.every(
            (v) =>
              v &&
              ["comment", "documentation", "example"].includes(v.kind) &&
              line(v.line) &&
              typeof v.text === "string" &&
              v.text.length <= 2048,
          ) &&
          Array.isArray(f.symbols) &&
          f.symbols.length <= 257 &&
          f.symbols.every(
            (v) =>
              v &&
              typeof v.name === "string" &&
              typeof v.shape === "string" &&
              typeof v.excerpt === "string" &&
              v.excerpt.length <= 4096 &&
              v.location?.path === path &&
              (!v.location.range ||
                (line(v.location.range.startLine) &&
                  (v.location.range.endLine === undefined || line(v.location.range.endLine)))) &&
              Array.isArray(v.calls) &&
              v.calls.length <= 512 &&
              v.calls.every((c) => c && typeof c.name === "string" && line(c.line)) &&
              strings(v.behavior, 32) &&
              strings(v.annotations, 32),
          ) &&
          strings(f.unknowns, 32) &&
          strings(f.truncated, 32),
      );
    return valid ? raw : undefined;
  } catch {
    return undefined;
  }
}
/** Only the explicit analyze CLI calls persistence. Gatherers remain read-only. */
export async function saveIndex(cwd: string, index: StructuralIndex): Promise<void> {
  const root = await realpath(cwd);
  const dir = join(root, ".repofit", "cache");
  for (const path of [join(root, ".repofit"), dir]) {
    try {
      if ((await lstat(path)).isSymbolicLink()) throw new Error(`refusing symlink cache: ${path}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    await mkdir(path, { recursive: true });
  }
  const target = join(dir, "structural-index.json");
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(index), { flag: "wx" });
  await rename(temp, target);
}

export async function buildIndex(
  cwd: string,
  previous?: StructuralIndex,
  rehash = false,
  budgets: { facts?: number; bytes?: number; files?: number; entries?: number } = {},
): Promise<StructuralIndex> {
  const index: StructuralIndex = {
    version: INDEX_VERSION,
    source: "git-index",
    files: {},
    manifest: [],
    coverage: { included: 0, excluded: 0, unparsed: 0, truncated: 0 },
    stats: { read: 0, reused: 0, deleted: 0 },
    unknowns: [],
  };
  let paths: string[];
  try {
    const result = await exec(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd, maxBuffer: 64 * 1024 * 1024 },
    );
    paths = [...new Set(result.stdout.split("\0").filter(Boolean))].sort();
  } catch {
    index.source = "filesystem";
    paths = [];
    let enumerated = 0;
    const visit = async (dir: string) => {
      if (enumerated >= (budgets.entries ?? 50000)) {
        index.unknowns.push(
          `Filesystem enumeration budget reached at ${dir}; manifest is incomplete.`,
        );
        return;
      }
      for await (const entry of await opendir(join(cwd, dir))) {
        if (++enumerated > (budgets.entries ?? 50000)) {
          index.unknowns.push(
            `Filesystem enumeration budget reached at ${dir}; manifest is incomplete.`,
          );
          break;
        }
        const path = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (EXCLUDED.test(path))
            index.manifest.push({
              path: `${path}/`,
              status: "excluded",
              reason: "dependency/build/cache directory (children not enumerated)",
            });
          else await visit(path);
        } else paths.push(path);
      }
    };
    await visit("");
    paths.sort();
  }
  let indexed = 0;
  let factBytes = 0;
  let readBytes = 0;
  for (const path of paths) {
    const adapter =
      /\.(?:[cm]?tsx?|[cm]?jsx?|cs|md|mdx|jsonc?|ya?ml|toml|xml|csproj|sh|bash)$/i.test(path);
    if (EXCLUDED.test(path) || !adapter) {
      index.manifest.push({
        path,
        status: "excluded",
        reason: EXCLUDED.test(path)
          ? "generated/dependency/build/cache path"
          : `unsupported adapter: ${extname(path) || "no extension"}`,
      });
      continue;
    }
    if (indexed >= (budgets.files ?? 10000)) {
      index.manifest.push({ path, status: "truncated", reason: "10000 indexed-file budget" });
      continue;
    }
    try {
      const info = await lstat(join(cwd, path));
      if (!info.isFile() || info.isSymbolicLink()) {
        index.manifest.push({
          path,
          status: "excluded",
          reason: "not a regular file (symlinks/submodules are not followed)",
        });
        continue;
      }
      if (info.size > 262144) {
        index.manifest.push({
          path,
          status: "truncated",
          reason: "256 KiB per-file budget; not parsed",
        });
        continue;
      }
      if (
        factBytes >= (budgets.facts ?? 24 * 1024 * 1024) ||
        readBytes + info.size > (budgets.bytes ?? 32 * 1024 * 1024)
      ) {
        index.manifest.push({
          path,
          status: "truncated",
          reason: "global fact/content budget; metadata accounted, content not parsed",
        });
        continue;
      }
      indexed++;
      const stamp = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
      const cached = previous?.version === INDEX_VERSION ? previous.files[path] : undefined;
      let facts: FileFacts;
      if (!rehash && cached?.stamp === stamp) {
        facts = cached;
        index.stats.reused++;
      } else {
        const text = await safeRead(cwd, path);
        index.stats.read++;
        readBytes += info.size;
        const digest = hash(text);
        facts = cached?.hash === digest ? { ...cached, stamp } : extract(path, text, digest, stamp);
      }
      const cost = Buffer.byteLength(JSON.stringify(facts));
      if (factBytes + cost > (budgets.facts ?? 24 * 1024 * 1024)) {
        index.manifest.push({
          path,
          status: "truncated",
          reason: "global fact budget; extracted facts omitted",
        });
        continue;
      }
      factBytes += cost;
      if (facts.unknowns.some((s) => s.startsWith("Unbalanced"))) {
        index.manifest.push({
          path,
          status: "unparsed",
          reason: "partial lexical facts: unbalanced delimiters",
        });
      } else
        index.manifest.push({
          path,
          status: facts.truncated.length ? "truncated" : "included",
          ...(facts.truncated.length ? { reason: facts.truncated.join(", ") } : {}),
        });
      index.files[path] = facts;
    } catch (err) {
      index.manifest.push({ path, status: "unparsed", reason: String(err) });
    }
  }
  for (const entry of index.manifest) index.coverage[entry.status]++;
  index.stats.deleted = Object.keys(previous?.files ?? {}).filter(
    (path) => !index.files[path],
  ).length;
  index.unknowns.push(
    "TypeScript and C# adapters collect lexical evidence, not compiler semantics. Unsupported files/frameworks are unknown, never proven absent.",
    "Unchanged files reuse facts using size/mtime/ctime; use --rehash when metadata cannot be trusted.",
  );
  return index;
}

export function dependencyFingerprint(
  index: StructuralIndex,
  paths: string[],
  extra: string,
): string {
  const relevant = new Set(paths);
  // Contracts have intentionally broad invalidation until symbol resolution is available.
  for (const f of Object.values(index.files)) if (f.contracts) relevant.add(f.path);
  const visit = (path: string) => {
    const file = index.files[path];
    for (const dep of file?.imports ?? []) {
      const base = dep.name.startsWith(".")
        ? relative(".", resolve(dirname(path), dep.name)).replaceAll(sep, "/")
        : "";
      const candidates = [
        base,
        base.replace(/\.js$/, ".ts"),
        `${base}.ts`,
        `${base}.tsx`,
        `${base}/index.ts`,
      ];
      for (const candidate of candidates)
        if (index.files[candidate] && !relevant.has(candidate)) {
          relevant.add(candidate);
          visit(candidate);
        }
    }
  };
  for (const path of paths) visit(path);
  return hash(
    JSON.stringify(
      [...relevant].sort().map((path) => [path, index.files[path]?.hash ?? "missing"]),
    ) + extra,
  );
}
