import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { probeNew } from "../src/cli/probe-new.js";

describe("probeNew", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "repofit-probe-new-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("scaffolds a predicate probe by default", async () => {
    const out = await probeNew({ id: "feat.example", dir: tmp });
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("wrote");

    const file = readFileSync(path.join(tmp, "feat-example.ts"), "utf8");
    expect(file).toContain('id: "feat.example"');
    expect(file).toContain('kind: "predicate"');
    expect(file).toContain("rationale:");
    expect(file).toContain("remediation:");
    expect(file).toContain("fixtures:");
  });

  test("scaffolds a count probe with samples block", async () => {
    const out = await probeNew({ id: "size.things", kind: "count", dir: tmp });
    expect(out.exitCode).toBe(0);

    const file = readFileSync(path.join(tmp, "size-things.ts"), "utf8");
    expect(file).toContain('kind: "count"');
    expect(file).toContain("samples:");
    expect(file).toContain("Location");
  });

  test("scaffolds a magnitude probe with bands", async () => {
    const out = await probeNew({ id: "latency.thing", kind: "magnitude", dir: tmp });
    expect(out.exitCode).toBe(0);

    const file = readFileSync(path.join(tmp, "latency-thing.ts"), "utf8");
    expect(file).toContain('kind: "magnitude"');
    expect(file).toContain("bands:");
    expect(file).toContain('unit: "ms"');
  });

  test("rejects an invalid kind", async () => {
    const out = await probeNew({ id: "feat.example", kind: "bogus", dir: tmp });
    expect(out.exitCode).toBe(2);
    expect(out.stdout).toContain("--kind must be one of");
  });

  test("rejects an invalid id format", async () => {
    const out = await probeNew({ id: "BadId", dir: tmp });
    expect(out.exitCode).toBe(2);
    expect(out.stdout).toContain("probe id must look like");
  });

  test("refuses to overwrite an existing file", async () => {
    await probeNew({ id: "feat.dup", dir: tmp });
    await expect(probeNew({ id: "feat.dup", dir: tmp })).rejects.toThrow(/refusing to overwrite/);
  });

  test("creates the output directory if it doesn't exist", async () => {
    const nested = path.join(tmp, "nested", "probes");
    const out = await probeNew({ id: "feat.nested", dir: nested });
    expect(out.exitCode).toBe(0);
    expect(readFileSync(path.join(nested, "feat-nested.ts"), "utf8")).toContain(
      'id: "feat.nested"',
    );
  });
});
