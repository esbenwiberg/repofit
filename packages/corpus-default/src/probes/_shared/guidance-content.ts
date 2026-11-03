import type { FilesEvidence, GuidanceFile } from "@esbenwiberg/repofit/sdk";

type GuidancePart = {
  path: string;
  text: string;
};

const INCLUDE_ONLY_RE = /^@([A-Za-z0-9._/ -]+)$/;

export async function readGuidanceParts(
  guidance: GuidanceFile[],
  files: FilesEvidence,
  maxChars: number,
): Promise<GuidancePart[]> {
  const resolver = createGuidanceResolver(guidance, files);
  const emitted = new Set<string>();
  const parts: GuidancePart[] = [];
  let remaining = maxChars;

  for (const file of guidance) {
    if (remaining <= 0) break;
    const resolved = await renderPath(file.path, resolver, emitted, new Set());
    if (!resolved) continue;
    const text = resolved.slice(0, remaining);
    parts.push({ path: file.path, text });
    remaining -= text.length;
  }

  return parts;
}

function createGuidanceResolver(guidance: GuidanceFile[], files: FilesEvidence) {
  const guidancePaths = new Map(guidance.map((file) => [normalizePath(file.path), file.path]));
  const lowerGuidancePaths = new Map(
    guidance.map((file) => [normalizePath(file.path).toLowerCase(), file.path]),
  );

  return {
    async read(path: string): Promise<string | undefined> {
      const resolved = await resolvePath(path, files, guidancePaths, lowerGuidancePaths);
      if (!resolved) return undefined;
      return files.readText(resolved);
    },
    async resolve(path: string): Promise<string | undefined> {
      return resolvePath(path, files, guidancePaths, lowerGuidancePaths);
    },
  };
}

async function renderPath(
  path: string,
  resolver: ReturnType<typeof createGuidanceResolver>,
  emitted: Set<string>,
  active: Set<string>,
): Promise<string | undefined> {
  const resolved = await resolver.resolve(path);
  if (!resolved) return undefined;

  const key = normalizePath(resolved).toLowerCase();
  if (emitted.has(key)) return undefined;
  if (active.has(key)) return `<!-- skipped recursive guidance include: ${resolved} -->`;
  active.add(key);
  emitted.add(key);

  const text = await resolver.read(resolved);
  if (text === undefined) {
    active.delete(key);
    return undefined;
  }

  const rendered: string[] = [];
  for (const line of splitLines(text)) {
    const includePath = parseIncludeOnly(line);
    if (!includePath) {
      rendered.push(line);
      continue;
    }
    const includeResolved = await resolver.resolve(includePath);
    const included = includeResolved
      ? await renderPath(includeResolved, resolver, emitted, active)
      : undefined;
    if (included) {
      rendered.push(`<!-- included from ${includeResolved ?? includePath} -->`);
      rendered.push(included);
    }
  }

  active.delete(key);
  return rendered.join("\n");
}

async function resolvePath(
  path: string,
  files: FilesEvidence,
  guidancePaths: Map<string, string>,
  lowerGuidancePaths: Map<string, string>,
): Promise<string | undefined> {
  const normalized = normalizePath(path);
  if (!isSafeRelativePath(normalized)) return undefined;
  const exactGuidance = guidancePaths.get(normalized);
  if (exactGuidance) return exactGuidance;
  const lowerGuidance = lowerGuidancePaths.get(normalized.toLowerCase());
  if (lowerGuidance) return lowerGuidance;
  if (files.has(normalized)) return normalized;
  return undefined;
}

function parseIncludeOnly(line: string): string | undefined {
  const match = INCLUDE_ONLY_RE.exec(line.trim());
  return match?.[1]?.trim();
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  return text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isSafeRelativePath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.split("/").includes("..");
}
