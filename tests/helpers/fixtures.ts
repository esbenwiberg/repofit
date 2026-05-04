import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach } from "vitest";

export { ACME_OVERLAY_DIR, REPO_ROOT } from "./paths.js";

const trackedDirs: string[] = [];

afterEach(async () => {
  while (trackedDirs.length > 0) {
    const dir = trackedDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

export async function makeRepoFixture(
  files?: Record<string, string>,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agentry-test-"));
  trackedDirs.push(root);
  if (files) {
    for (const [rel, contents] of Object.entries(files)) {
      const full = resolve(root, rel);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, contents);
    }
  }
  return root;
}

export async function makeGitRepoFixture(
  files?: Record<string, string>,
): Promise<string> {
  const root = await makeRepoFixture(files);
  await mkdir(resolve(root, ".git"), { recursive: true });
  return root;
}

export function overlayManifestToml(
  id: string,
  opts: { version?: string; description?: string } = {},
): string {
  return [
    `id = "${id}"`,
    `version = "${opts.version ?? "0.1.0"}"`,
    `description = "${opts.description ?? "demo overlay"}"`,
  ].join("\n");
}

export function overlayRegistrationToml(
  entries: Array<{ id: string; path: string }>,
): string {
  return entries
    .map((e) =>
      [`[[overlay]]`, `id = "${e.id}"`, `path = "${e.path}"`].join("\n"),
    )
    .join("\n\n");
}
