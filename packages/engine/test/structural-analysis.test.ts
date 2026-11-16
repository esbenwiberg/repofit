import { execFile, execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extract } from "../src/evidence/structural/adapters.js";
import { analyzeRepository } from "../src/evidence/structural/analysis.js";
import { groupPackets, judgePackets } from "../src/evidence/structural/discovery.js";
import { buildIndex, loadIndex, saveIndex } from "../src/evidence/structural/indexer.js";
import {
  assessPolicies,
  discoverBypasses,
  parsePolicy,
} from "../src/evidence/structural/policies.js";
import { assessReadiness } from "../src/evidence/structural/readiness.js";
import { INDEX_VERSION } from "../src/evidence/structural/types.js";
import { computeCacheKey, parseJudgeInput } from "../src/evidence/subsystems/judge.js";
import type { JudgeEvidence, JudgeRequest } from "../src/sdk/types.js";

const run = promisify(execFile);
let cwd: string;
async function put(path: string, value: string) {
  await mkdir(join(cwd, path, ".."), { recursive: true });
  await writeFile(join(cwd, path), value);
}
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "repofit-structural-test-"));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});
const policy = {
  version: 1,
  rules: [
    {
      id: "use-wrapper",
      kind: "restricted-call",
      scope: ["src/**"],
      match: "fetch",
      replacement: "client.request",
      rationale: "central authentication",
      documentation: ["docs/*.md"],
    },
  ],
};
const descriptor = {
  schema: 1,
  source: { tool: "auto-qa", config: ".auto-qa/config.json" },
  features: [
    {
      id: "checkout",
      name: "Checkout",
      paths: ["src/checkout.ts"],
      expectationSource: { kind: "requirement", reference: "spec/checkout" },
    },
  ],
  capabilities: {
    start: { command: ["npm", "run", "dev"], status: "declared" },
    reset: { url: "http://localhost:3000/reset", method: "POST", status: "declared" },
  },
};

describe("lexical language-independent facts", () => {
  it("collects TS/C# symbols, generic calls, annotations and behavior without fixed business categories", () => {
    const ts = extract(
      "src/a.ts",
      "export async function synchronize(x) { try { return await cache.load(x); } catch(e) { throw e; } }",
      "h",
      "s",
    );
    const cs = extract(
      "src/B.cs",
      "using Product.Shared;\nclass B { [Authorize] public async Task Sync() { return await cache.Load(); } }",
      "h",
      "s",
    );
    expect(ts.symbols.find((s) => s.name === "synchronize")).toMatchObject({
      behavior: ["await", "catch", "return", "throw", "try"],
      calls: [{ name: "cache.load", line: 1 }],
    });
    expect(cs.imports).toContainEqual({ name: "Product.Shared", line: 1 });
    expect(cs.symbols.find((s) => s.name === "Sync")).toMatchObject({
      annotations: ["Authorize"],
      calls: [{ name: "cache.Load", line: 2 }],
    });
  });
  it("does not turn comments, strings, regexes, C# raw literals or declaration names into API calls", () => {
    const ts = extract(
      "a.ts",
      '// fetch()\nconst text = "fetch()"; const re=/fetch()/; function fetch() {}\nconst x = `fetch()`;',
      "h",
      "s",
    );
    expect(ts.symbols.flatMap((s) => s.calls).map((c) => c.name)).not.toContain("fetch");
    const cs = extract(
      "a.cs",
      'class X { string x = """fetch()"""; void Go() { client.Send(); } }',
      "h",
      "s",
    );
    expect(cs.symbols.flatMap((s) => s.calls).map((c) => c.name)).not.toContain("fetch");
    expect(cs.unknowns.join(" ")).toContain("unknown");
  });
  it("records excerpt/collection caps and unbalanced syntax rather than claiming complete parsing", () => {
    const f = extract(
      "a.ts",
      `${"// useful comment\n".repeat(140)}function x() { ${"a();".repeat(1100)}`,
      "h",
      "s",
    );
    expect(f.truncated).toEqual(
      expect.arrayContaining(["comment collection", "module excerpt", "call facts"]),
    );
    expect(f.unknowns.join(" ")).toContain("Unbalanced");
    expect(extract("README.md", "x".repeat(2100), "h", "s").truncated).toContain(
      "documentation line excerpt",
    );
  });
});

describe("incremental persistent index and coverage", () => {
  it("reuses unchanged content without reading bytes, detects add/edit/delete and shared-contract invalidation", async () => {
    await put(
      "src/a.ts",
      'import { Contract } from "./contract"; export function execute(x) { return client.request(x); }',
    );
    await put(
      "src/b.ts",
      'import { Contract } from "./contract"; export function apply(x) { try { return client.request(x); } catch(e) { throw e; } }',
    );
    await put("src/contract.ts", "export interface Contract { id: string; }");
    const first = await buildIndex(cwd);
    await saveIndex(cwd, first);
    const warm = await buildIndex(cwd, await loadIndex(cwd));
    expect(warm.stats).toMatchObject({ read: 0, reused: 3, deleted: 0 });
    const before = groupPackets(warm).packets.find((p) => p.group === "call:client.request");
    expect(before).toBeDefined();
    await put("src/contract.ts", "export interface Contract { id: string; revision: number; }");
    const changed = await buildIndex(cwd, warm);
    expect(changed.stats).toMatchObject({ read: 1, reused: 2 });
    expect(
      groupPackets(changed).packets.find((p) => p.group === "call:client.request")?.id,
    ).not.toBe(before?.id);
    await rm(join(cwd, "src/a.ts"));
    await put("src/renamed.ts", "export function replaced() { other.run(); }");
    const moved = await buildIndex(cwd, changed);
    expect(moved.stats.deleted).toBe(1);
    expect(moved.files["src/renamed.ts"]).toBeDefined();
    expect((await buildIndex(cwd, moved, true)).stats.read).toBe(3);
  });
  it("does not inherit size-stats first5000 limit and accounts exclusions, unsupported and symlinks", async () => {
    await mkdir(join(cwd, "docs"));
    for (let start = 0; start < 5002; start += 100)
      await Promise.all(
        Array.from({ length: Math.min(100, 5002 - start) }, (_, n) =>
          put(`docs/${start + n}.txt`, "x"),
        ),
      );
    await put("src/z.ts", "const x = 1;");
    await put("src/x.py", "print('unknown')");
    await symlink("/etc/hosts", join(cwd, "src/outside.ts"));
    const index = await buildIndex(cwd);
    expect(index.manifest).toHaveLength(5005);
    expect(index.files["src/z.ts"]).toBeDefined();
    expect(index.manifest.find((m) => m.path === "src/x.py")).toMatchObject({
      status: "excluded",
      reason: "unsupported adapter: .py",
    });
    expect(index.manifest.find((m) => m.path === "src/outside.ts")?.status).toBe("excluded");
    expect(Object.values(index.coverage).reduce((a, b) => a + b, 0)).toBe(index.manifest.length);
  });
  it("caps a flat filesystem walk at the declared enumeration budget", async () => {
    for (let i = 0; i < 25; i++) await put(`${i}.ts`, "const x = 1;");
    const index = await buildIndex(cwd, undefined, false, { entries: 10 });
    expect(index.manifest).toHaveLength(10);
    expect(index.unknowns.join(" ")).toContain("manifest is incomplete");
  });

  it("handles corrupt/stale cache and enforces global budgets with warm reuse of included facts", async () => {
    await put("a.ts", "function a() { api.run(); }");
    await put("b.ts", "function b() { try { api.run(); } catch(e) { throw e; } }");
    const limited = await buildIndex(cwd, undefined, false, { facts: 1600 });
    expect(limited.coverage.truncated).toBeGreaterThan(0);
    expect(Object.keys(limited.files).length).toBeGreaterThan(0);
    await saveIndex(cwd, limited);
    const warm = await buildIndex(cwd, await loadIndex(cwd), false, { facts: 1600 });
    expect(warm.stats.reused).toBeGreaterThan(0);
    await put(".repofit/cache/structural-index.json", "not-json");
    expect(await loadIndex(cwd)).toBeUndefined();
    await put(
      ".repofit/cache/structural-index.json",
      JSON.stringify({ version: "old", files: {}, manifest: [] }),
    );
    expect(await loadIndex(cwd)).toBeUndefined();
    await put(
      ".repofit/cache/structural-index.json",
      JSON.stringify({ version: INDEX_VERSION, files: { "a.ts": { path: "a.ts" } }, manifest: [] }),
    );
    expect(await loadIndex(cwd)).toBeUndefined();
    const valid = await buildIndex(cwd);
    for (const mutate of [
      (f: Record<string, unknown>) => {
        f.texts = [null];
      },
      (f: Record<string, unknown>) => {
        f.symbols = [{ name: "x", behavior: [null] }];
      },
    ]) {
      const corrupt = structuredClone(valid);
      mutate(corrupt.files["a.ts"] as unknown as Record<string, unknown>);
      await put(".repofit/cache/structural-index.json", JSON.stringify(corrupt));
      expect(await loadIndex(cwd)).toBeUndefined();
      expect((await analyzeRepository(cwd)).index.stats.read).toBeGreaterThan(0);
    }
  });
});

describe("repo declarations and descriptive discovery", () => {
  it("checks selected APIs/import boundaries with related evidence, preserving scoped exceptions", async () => {
    await put("src/a.ts", 'import db from "private/db"; export function go() { fetch("/"); }');
    await put("src/allowed.ts", 'fetch("/");');
    const p = parsePolicy(
      JSON.stringify({
        ...policy,
        rules: [
          ...policy.rules.map((r) => ({ ...r, allowed: ["src/allowed.ts"] })),
          {
            id: "boundary",
            kind: "module-boundary",
            scope: ["src/**"],
            match: "private/**",
            rationale: "use public contracts",
          },
        ],
      }),
    );
    const findings = assessPolicies(await buildIndex(cwd), p);
    expect(findings.filter((f) => f.ruleId === "use-wrapper")).toHaveLength(1);
    expect(findings.filter((f) => f.ruleId === "boundary")).toHaveLength(1);
    expect(findings[0]?.relatedLocations).toContainEqual({
      path: "repofit.policy.json#use-wrapper",
    });
    expect(findings[0]?.message).toContain("Name resolution is not established");
  });
  it("finds broad suppressions and policy-conflicting examples without banning useful comments", async () => {
    await put(
      "src/a.ts",
      "// @ts-expect-error: fixture boundary\n// fetch() used before migration\nconst x = 1;",
    );
    await put("docs/API.md", "```ts\nfetch('/');\n```\nDo not copy this counterexample.");
    const p = parsePolicy(JSON.stringify(policy));
    const index = await buildIndex(cwd);
    const findings = discoverBypasses(index, p);
    expect(findings.some((f) => f.kind === "suppression" && f.severity === "info")).toBe(true);
    expect(
      findings.some((f) => f.kind === "misleading-example" && f.location.path === "docs/API.md"),
    ).toBe(true);
    expect(assessPolicies(index, p)).toEqual([]);
    expect(findings.every((f) => f.confidence === "heuristic")).toBe(true);
  });
  it("marks required-call absence as uncertain and does not infer policy from majority", async () => {
    await put("a.ts", "function alpha() { service.run(); }");
    await put("b.ts", "function omega() { try { service.run(); } catch(e) { throw e; } }");
    const index = await buildIndex(cwd);
    expect(groupPackets(index).packets.some((p) => p.group === "call:service.run")).toBe(true);
    expect(assessPolicies(index)).toEqual([]);
    const p = parsePolicy(
      JSON.stringify({
        version: 1,
        rules: [
          {
            id: "required",
            kind: "required-call",
            scope: ["*.ts"],
            match: "authorize",
            rationale: "explicit scoped requirement",
          },
        ],
      }),
    );
    expect(
      assessPolicies(index, p).every((f) => f.confidence === "heuristic" && f.severity === "info"),
    ).toBe(true);
  });
  it("rejects malformed rules/unsafe fixtures and ambiguous experiment rejection criteria", () => {
    for (const replacement of [42, {}])
      expect(() =>
        parsePolicy(JSON.stringify({ ...policy, rules: [{ ...policy.rules[0], replacement }] })),
      ).toThrow();
    const e = {
      id: "a",
      argv: ["node", "{fixture}"],
      expectedDiagnostic: "",
      valid: { path: "ok.ts", content: "" },
      invalid: { path: "bad.ts", content: "" },
    };
    expect(() => parsePolicy(JSON.stringify({ ...policy, experiments: [e] }))).toThrow();
    expect(() =>
      parsePolicy(
        JSON.stringify({
          ...policy,
          experiments: [
            { ...e, expectedDiagnostic: "violation", invalid: { path: "../bad", content: "" } },
          ],
        }),
      ),
    ).toThrow();
    expect(() =>
      parsePolicy(
        JSON.stringify({
          ...policy,
          experiments: [
            { ...e, expectedDiagnostic: "violation" },
            { ...e, expectedDiagnostic: "violation" },
          ],
        }),
      ),
    ).toThrow();
  });
});

describe("configuration and scoped guide packets", () => {
  it("deduplicates overlap and captures config bypasses without removing comments", async () => {
    await put("a.ts", "// eslint-disable-next-line no-explicit-any\nconst x: any = 1;");
    await put(".github/workflows/test.yml", "steps:\n  - continue-on-error: true\n");
    const findings = discoverBypasses(await buildIndex(cwd));
    expect(findings.filter((f) => f.location.path === "a.ts")).toHaveLength(1);
    expect(
      findings.some(
        (f) => f.location.path.endsWith("test.yml") && f.message.includes("continue-on-error"),
      ),
    ).toBe(true);
  });
  it("supplies scoped guide locations and leading comments to optional review", async () => {
    await put(
      "src/a.ts",
      "// acquire a lease before invocation\nfunction alpha() { service.run(); }",
    );
    await put("src/b.ts", "function beta() { return service.run(); }");
    await put("src/README.md", "Invocation requires a lease.");
    await put("other/README.md", "Unrelated subsystem.");
    const packets = groupPackets(await buildIndex(cwd)).packets;
    const packet = packets.find((p) => p.group === "call:service.run");
    expect(packet?.locations.some((l) => l.path === "src/README.md")).toBe(true);
    expect(packet?.locations.some((l) => l.path === "other/README.md")).toBe(false);
    expect(packet?.input).toContain("acquire a lease");
  });
});

describe("explicit command/model boundaries", () => {
  it("never runs declared experiments by default; observes legitimate and invalid cases in disposable snapshots", async () => {
    await put("marker.txt", "original");
    await writeFile(join(cwd, "binary.bin"), Buffer.from([0, 255, 128, 10]));
    await put(
      "checker.mjs",
      `import {readFileSync} from 'node:fs'; if(!readFileSync(new URL('./binary.bin',import.meta.url)).equals(Buffer.from([0,255,128,10]))) process.exit(19); if(readFileSync(process.argv[2],'utf8').includes('forbidden')) {console.error('RULE:forbidden');process.exit(7);}`,
    );
    const e = {
      id: "oracle",
      argv: [process.execPath, "{repo}/checker.mjs", "{fixture}"],
      valid: { path: "ok.ts", content: "allowed()" },
      invalid: { path: "bad.ts", content: "forbidden()" },
      expectedDiagnostic: "RULE:forbidden",
    };
    await put("repofit.policy.json", JSON.stringify({ ...policy, experiments: [e] }));
    const declared = await analyzeRepository(cwd);
    expect(declared.policy.experiments[0]).toMatchObject({
      configured: true,
      executed: false,
      rejectsInvalid: null,
      acceptsLegitimate: null,
      executions: [],
    });
    const observed = await analyzeRepository(cwd, { experiment: true });
    expect(observed.policy.experiments[0]).toMatchObject({
      executed: true,
      acceptsLegitimate: true,
      rejectsInvalid: true,
    });
    expect(observed.policy.experiments[0]?.executions.map((r) => r.exitCode)).toEqual([0, 7]);
    expect(await readFile(join(cwd, "marker.txt"), "utf8")).toBe("original");
    expect(
      observed.policy.experiments[0]?.executions.every(
        (r) => !r.argv.some((a) => a.includes(cwd)) && r.cwd !== cwd,
      ),
    ).toBe(true);
    await put(
      "repofit.policy.json",
      JSON.stringify({ ...policy, experiments: [{ ...e, expectedDiagnostic: "different rule" }] }),
    );
    expect(
      (await analyzeRepository(cwd, { experiment: true })).policy.experiments[0]?.rejectsInvalid,
    ).toBe(false);
  });
  it("invalidates proof when a legitimate case rewrites checker inputs; cases get pristine snapshots", async () => {
    const script = `import {readFileSync,writeFileSync} from 'node:fs'; if(readFileSync(process.argv[2],'utf8').includes('bad')) {console.error('RULE:bad');process.exit(7)} writeFileSync(import.meta.filename,'process.exit(0)');`;
    await put("check.mjs", script);
    const e = {
      id: "mutation",
      argv: [process.execPath, "{repo}/check.mjs", "{fixture}"],
      valid: { path: "ok.ts", content: "ok" },
      invalid: { path: "bad.ts", content: "bad" },
      expectedDiagnostic: "RULE:bad",
    };
    await put("repofit.policy.json", JSON.stringify({ version: 1, rules: [], experiments: [e] }));
    const report = await analyzeRepository(cwd, { experiment: true });
    expect(report.policy.experiments[0]).toMatchObject({
      executed: true,
      integrity: "mutated",
      acceptsLegitimate: false,
      rejectsInvalid: false,
    });
    expect(report.policy.experiments[0]?.executions.map((r) => r.exitCode)).toEqual([0, 7]);
    expect(await readFile(join(cwd, "check.mjs"), "utf8")).toBe(script);
  });
  it("rejects checker mutation of the supplied invalid fixture", async () => {
    await put(
      "check.mjs",
      `import {readFileSync,writeFileSync} from 'node:fs'; const file=process.argv[2]; if(readFileSync(file,'utf8')==='bad') { writeFileSync(file,'good'); console.error('RULE:bad'); process.exit(7); }`,
    );
    await put(
      "repofit.policy.json",
      JSON.stringify({
        version: 1,
        rules: [],
        experiments: [
          {
            id: "fixture-mutation",
            argv: [process.execPath, "{repo}/check.mjs", "{fixture}"],
            valid: { path: "ok", content: "good" },
            invalid: { path: "bad", content: "bad" },
            expectedDiagnostic: "RULE:bad",
          },
        ],
      }),
    );
    const report = await analyzeRepository(cwd, { experiment: true });
    expect(report.policy.experiments[0]).toMatchObject({
      integrity: "mutated",
      acceptsLegitimate: false,
      rejectsInvalid: false,
    });
    expect(report.policy.experiments[0]?.executions.map((r) => r.exitCode)).toEqual([0, 7]);
  });

  it("preserves executable modes for a directly invoked checker", async () => {
    await put(
      "check.sh",
      '#!/bin/sh\nif test "$(cat "$1")" = bad; then echo RULE:bad >&2; exit 7; fi\n',
    );
    await chmod(join(cwd, "check.sh"), 0o755);
    await put(
      "repofit.policy.json",
      JSON.stringify({
        version: 1,
        rules: [],
        experiments: [
          {
            id: "executable",
            argv: ["{repo}/check.sh", "{fixture}"],
            valid: { path: "ok", content: "ok" },
            invalid: { path: "bad", content: "bad" },
            expectedDiagnostic: "RULE:bad",
          },
        ],
      }),
    );
    const report = await analyzeRepository(cwd, { experiment: true });
    expect(report.policy.experiments[0]).toMatchObject({
      integrity: "unchanged",
      acceptsLegitimate: true,
      rejectsInvalid: true,
    });
  });
  it("times out and kills a ready descendant server inheriting checker pipes", async () => {
    // A real passive server survives IPC disconnection when only its parent is killed.
    const child =
      "require('node:net').createServer().listen(0,'127.0.0.1',()=>process.send('ready'));";
    await put(
      "check.mjs",
      `import {spawn} from 'node:child_process'; const child = spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:['ignore','inherit','inherit','ipc']}); child.on('message', message => { if(message==='ready') process.stdout.write('descendant:'+child.pid+'\\n'); });`,
    );
    await put(
      "repofit.policy.json",
      JSON.stringify({
        version: 1,
        rules: [],
        experiments: [
          {
            id: "timeout",
            argv: [process.execPath, "{repo}/check.mjs", "{fixture}"],
            valid: { path: "ok", content: "ok" },
            invalid: { path: "bad", content: "bad" },
            expectedDiagnostic: "never",
            timeoutMs: 500,
          },
        ],
      }),
    );
    const started = performance.now();
    const report = await analyzeRepository(cwd, { experiment: true });
    expect(performance.now() - started).toBeLessThan(2500);
    const executions = report.policy.experiments[0]?.executions ?? [];
    expect(executions.every((r) => r.timedOut)).toBe(true);
    expect(report.policy.experiments[0]?.rejectsInvalid).toBe(false);
    const descendants = executions.flatMap((r) =>
      [...r.stdout.matchAll(/^descendant:(\d+)$/gm)].map((m) => Number(m[1])),
    );
    expect(descendants).toHaveLength(2); // Both descendants reached actual server readiness.
    for (const pid of descendants)
      await vi.waitFor(
        () => {
          try {
            process.kill(pid, 0);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
            throw error;
          }
          // Linux may retain a killed orphan as a zombie until init reaps it; it cannot run.
          let state: string;
          try {
            state = execFileSync("ps", ["-p", String(pid), "-o", "stat="], {
              encoding: "utf8",
              stdio: ["ignore", "pipe", "ignore"],
            }).trim();
          } catch (error) {
            if ((error as { status?: number }).status === 1) return;
            throw error;
          }
          expect(state).toMatch(/^Z/);
        },
        { timeout: 2000, interval: 25 },
      );
  });

  it("uses structured bounded judge packets and rejects invented related locations", async () => {
    await put("a.ts", "function one() { api.get(); }");
    await put("b.ts", "function two() { try { api.get(); } catch(e) { throw e; } }");
    const packets = groupPackets(await buildIndex(cwd)).packets;
    expect(packets.length).toBeGreaterThan(0);
    expect(packets.every((p) => Buffer.byteLength(p.input) <= 16000)).toBe(true);
    const requests: JudgeRequest[] = [];
    const judge: JudgeEvidence = {
      defaultModel: "test",
      score: async (req) => {
        requests.push(req);
        return {
          score: 50,
          perCriterion: { coherence: 50 },
          rationale: "test fixture, not a live semantic evaluation",
          model: "test",
          fromCache: false,
          findings: [
            {
              location: req.relatedLocations?.[0] ?? { path: "a.ts" },
              relatedLocations: [req.relatedLocations?.[1] ?? { path: "b.ts" }],
              severity: "info",
              message: "scoped expected behavior differs",
            },
          ],
        };
      },
    };
    expect((await judgePackets(packets, judge)).length).toBeGreaterThan(0);
    expect(requests.every((r) => r.relatedLocations && r.relatedLocations.length >= 2)).toBe(true);
    const locs = [{ path: "a.ts" }, { path: "b.ts" }];
    const response = {
      perCriterion: { coherence: 50 },
      rationale: "r",
      findings: [
        { locationIndex: 0, relatedLocationIndices: [1], severity: "warn", message: "evidence" },
      ],
    };
    expect(parseJudgeInput(response, ["coherence"], locs).findings?.[0]?.relatedLocations).toEqual([
      { path: "b.ts" },
    ]);
    for (const f of [
      null,
      "bad",
      { ...response.findings[0], locationIndex: 20 },
      { ...response.findings[0], relatedLocationIndices: [1, 1] },
    ])
      expect(() => parseJudgeInput({ ...response, findings: [f] }, ["coherence"], locs)).toThrow(
        /judge:/,
      );
    const req = requests[0] as JudgeRequest;
    expect(computeCacheKey(req, "one")).not.toBe(computeCacheKey(req, "two"));
    expect(computeCacheKey(req, "one")).not.toBe(
      computeCacheKey({ ...req, probeVersion: "changed-prompt" }, "one"),
    );
  });
  it("invokes the actual CLI, persists incremental cache and never calls a model by default", async () => {
    await put("a.ts", "function alpha() { service.run(); }");
    await put("b.ts", "function beta() { return service.run(); }");
    const cli = resolve("dist/cli/index.js");
    const first = JSON.parse(
      (
        await run(process.execPath, [cli, "analyze", "--cwd", cwd], {
          env: { ...process.env, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", OPENAI_BASE_URL: "" },
        })
      ).stdout,
    );
    const second = JSON.parse((await run(process.execPath, [cli, "analyze", "--cwd", cwd])).stdout);
    expect(first.advisory).toBe(true);
    expect(first.discovery.unknowns.join(" ")).toContain("no model was invoked");
    expect(second.index.stats).toMatchObject({ read: 0, reused: 2 });
    expect(
      JSON.parse(await readFile(join(cwd, ".repofit/cache/structural-index.json"), "utf8")).version,
    ).toBe(INDEX_VERSION);
  });
});

describe("shared verification descriptor", () => {
  it("reads AutoQA-neutral declarations and retains unknown observed readiness", async () => {
    await put(".agent/verification.json", JSON.stringify(descriptor));
    const report = await assessReadiness(cwd);
    expect(report.declared).toEqual(descriptor);
    expect(report.observed).toEqual([]);
    expect(report.unknowns.join(" ")).toContain("not observed");
    expect(report.unknowns.join(" ")).toContain("inspect capability is undeclared");
  });
  it("accepts AutoQA-exported {port} hook declarations without execution or port resolution", async () => {
    const exported = {
      ...descriptor,
      capabilities: {
        start: { command: ["sh", "-c", "node app.mjs --port {port}"], status: "declared" },
        reset: { url: "http://localhost:{port}/reset", method: "POST", status: "declared" },
        inspect: { url: "http://127.0.0.1:{port}/inspect", method: "GET", status: "declared" },
      },
    };
    await put(".agent/verification.json", JSON.stringify(exported));
    const report = await assessReadiness(cwd);
    expect(report.declared).toEqual(exported);
    expect(report.observed).toEqual([]);
    expect((report.declared as typeof exported).capabilities.reset.url).toBe(
      "http://localhost:{port}/reset",
    );
    await put(
      ".agent/verification.json",
      JSON.stringify({
        ...exported,
        capabilities: { reset: { url: "http://localhost:{unknown}/reset", status: "declared" } },
      }),
    );
    expect((await assessReadiness(cwd)).declared).toBeNull();
  });

  it("rejects empty control claims, unsafe paths and invalid HTTP controls", async () => {
    for (const c of [
      { status: "declared" },
      { status: "declared", command: [] },
      { status: "observed", command: ["npm"] },
      { status: "declared", url: "file:///tmp/x" },
      { status: "declared", url: "https://local/", method: "INVALID" },
    ]) {
      await put(
        ".agent/verification.json",
        JSON.stringify({ ...descriptor, capabilities: { start: c } }),
      );
      expect((await assessReadiness(cwd)).declared).toBeNull();
    }
    for (const path of ["../x", "C:\\x", "..\\x", "/absolute"]) {
      await put(
        ".agent/verification.json",
        JSON.stringify({ ...descriptor, features: [{ ...descriptor.features[0], paths: [path] }] }),
      );
      expect((await assessReadiness(cwd)).declared).toBeNull();
    }
  });
});
