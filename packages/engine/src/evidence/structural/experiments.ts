import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { exec } from "../../util/exec.js";
import { commandsSubsystem } from "../subsystems/commands.js";
import { safeReadBytes } from "./indexer.js";
import type { ExperimentResult, Policy, StructuralIndex } from "./types.js";

const excluded =
  /(?:^|\/)(?:node_modules|\.git|\.repofit|dist|build|bin|obj|coverage|vendor)(?:\/|$)/;
const digest = (data: Buffer) => createHash("sha256").update(data).digest("hex");
async function inventory(cwd: string): Promise<string[]> {
  try {
    const result = await exec(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd, maxBuffer: 64 * 1024 * 1024 },
    );
    return [...new Set(result.stdout.split("\0").filter((p) => p && !excluded.test(p)))].sort();
  } catch {
    const paths: string[] = [];
    const walk = async (dir: string) => {
      for (const e of await readdir(join(cwd, dir), { withFileTypes: true })) {
        const path = dir ? `${dir}/${e.name}` : e.name;
        if (excluded.test(path)) continue;
        if (paths.length > 10000) throw new Error("integrity inventory exceeds 10000 files");
        if (e.isDirectory()) await walk(path);
        else if (e.isFile()) paths.push(path);
        else throw new Error(`Snapshot does not support symlink/submodule: ${path}`);
      }
    };
    await walk("");
    return paths.sort();
  }
}
async function contents(
  cwd: string,
  paths: string[],
): Promise<Map<string, { buffer: Buffer; mode: number }>> {
  const out = new Map<string, { buffer: Buffer; mode: number }>();
  let bytes = 0;
  for (const path of paths) {
    const stat = await lstat(join(cwd, path));
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error(`Snapshot does not support symlink/submodule: ${path}`);
    const buffer = await safeReadBytes(cwd, path, 1024 * 1024);
    bytes += buffer.length;
    if (bytes > 32 * 1024 * 1024 || out.size >= 10000)
      throw new Error("disposable snapshot exceeds 32 MiB/10000 files");
    out.set(path, { buffer, mode: stat.mode & 0o777 });
  }
  return out;
}
function fingerprints(files: Map<string, { buffer: Buffer; mode: number }>): string {
  return JSON.stringify([...files].map(([path, { buffer, mode }]) => [path, digest(buffer), mode]));
}
async function gitState(cwd: string): Promise<string> {
  try {
    const head = await exec("git", ["rev-parse", "HEAD"], { cwd });
    const index = await exec("git", ["ls-files", "--stage", "-z"], {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
    });
    return JSON.stringify([head.stdout, index.stdout]);
  } catch {
    return "no git HEAD/index";
  }
}

/** Independent identical snapshots plus integrity observations, not an OS security sandbox. */
export async function runExperiments(
  cwd: string,
  policy: Policy | undefined,
  _index: StructuralIndex,
): Promise<ExperimentResult[]> {
  const results: ExperimentResult[] = [];
  for (const e of policy?.experiments ?? []) {
    const root = await mkdtemp(join(tmpdir(), "repofit-policy-"));
    const commands = commandsSubsystem.gather({ cwd: root });
    try {
      if (process.platform === "win32")
        throw new Error(
          "Disposable experiments require POSIX process-group cleanup; not supported on Windows yet.",
        );
      if (e.argv.some((a) => a.includes(resolve(cwd))))
        throw new Error(
          "use {repo} for disposable snapshot paths; original repository arguments are forbidden",
        );
      const source = await contents(cwd, await inventory(cwd));
      const baseline = fingerprints(source);
      const originalGit = await gitState(cwd);
      let unchanged = true;
      const runs = [];
      for (const [kind, fixture] of [
        ["valid", e.valid],
        ["invalid", e.invalid],
      ] as const) {
        const dir = join(root, kind);
        const snapshot = join(dir, "repo");
        for (const [path, { buffer, mode }] of source) {
          const destination = join(snapshot, path);
          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, buffer);
          await chmod(destination, mode);
        }
        const file = join(dir, "example", fixture.path);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, fixture.content, "utf8");
        const fixturePath = `example/${fixture.path}`;
        const fixtureBaseline = fingerprints(await contents(dir, [fixturePath]));
        const argv = e.argv.map((a) =>
          a.replaceAll("{fixture}", file).replaceAll("{repo}", snapshot),
        );
        runs.push(
          await commands.run({
            argv,
            cwd: dirname(file),
            timeoutMs: e.timeoutMs ?? 10000,
            killProcessGroup: true,
            env: { REPOFIT_EXPERIMENT_ROOT: dir },
          }),
        );
        const fixtureUnchanged =
          fingerprints(await contents(dir, [fixturePath])) === fixtureBaseline;
        unchanged = unchanged && fixtureUnchanged;
        unchanged =
          unchanged &&
          fingerprints(await contents(snapshot, await inventory(snapshot))) === baseline;
        unchanged =
          unchanged &&
          fingerprints(await contents(cwd, await inventory(cwd))) === baseline &&
          (await gitState(cwd)) === originalGit;
      }
      const valid = runs[0];
      const invalid = runs[1];
      const diagnostic = `${invalid?.stdout ?? ""}\n${invalid?.stderr ?? ""}`;
      results.push({
        id: e.id,
        configured: true,
        executed: true,
        integrity: unchanged ? "unchanged" : "mutated",
        acceptsLegitimate: unchanged && valid?.exitCode === 0 && !valid.timedOut,
        rejectsInvalid:
          unchanged &&
          invalid?.exitCode !== null &&
          invalid?.exitCode !== 0 &&
          !invalid?.timedOut &&
          diagnostic.includes(e.expectedDiagnostic),
        reason: unchanged
          ? "Observed using independent binary-preserving snapshots with unchanged copied inputs and original source/HEAD/index. Trusted checker, not an OS sandbox."
          : "Checker mutated copied inputs or original source/HEAD/index; exit codes cannot establish enforcement proof.",
        executions: [...(commands.records?.() ?? [])],
      });
    } catch (err) {
      results.push({
        id: e.id,
        configured: true,
        executed: (commands.records?.().length ?? 0) > 0,
        integrity: "unknown",
        acceptsLegitimate: null,
        rejectsInvalid: null,
        reason: String(err),
        executions: [...(commands.records?.() ?? [])],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  return results;
}
