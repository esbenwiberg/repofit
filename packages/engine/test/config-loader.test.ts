import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  CONFIG_FILENAME,
  isIncludeToken,
  loadProjectConfig,
  splitInclude,
  validateConfig,
} from "../src/loader/config.js";

describe("config loader", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "repofit-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("missing config → null", async () => {
    expect(await loadProjectConfig(tmp)).toBeNull();
  });

  test("minimal valid config", async () => {
    writeFileSync(
      join(tmp, CONFIG_FILENAME),
      JSON.stringify({ version: 1, gate: { mode: "advisory" } }),
    );
    const cfg = await loadProjectConfig(tmp);
    expect(cfg?.gate.mode).toBe("advisory");
  });

  test("gate.include accepts tiers and probe ids, rejects anything else", () => {
    const cfg = validateConfig({
      version: 1,
      gate: { mode: "advisory", include: ["executed", "agent.skill-evals-present"] },
    });
    expect(cfg.gate.include).toEqual(["executed", "agent.skill-evals-present"]);
    expect(splitInclude(cfg.gate.include ?? [])).toEqual({
      tiers: new Set(["executed"]),
      probeIds: new Set(["agent.skill-evals-present"]),
    });
    expect(() =>
      validateConfig({ version: 1, gate: { mode: "advisory", include: ["fast"] } }),
    ).toThrow(/gate\/include\/0.*tier.*probe id/);
    expect(isIncludeToken("reasoned")).toBe(true);
    expect(isIncludeToken("tests.mutation-configured")).toBe(true);
    expect(isIncludeToken("Agent.Skills")).toBe(false);
    expect(isIncludeToken("agent")).toBe(false);
  });

  test("full config round-trips through validation", () => {
    const cfg = validateConfig({
      version: 1,
      corpus: [{ package: "@esbenwiberg/corpus-default", version: "1.0.0" }],
      gate: { mode: "absolute", absoluteThreshold: 70, include: ["static", "derived"] },
      dimensions: {
        context: {
          weight: 25,
          threshold: 60,
          probes: { "agent.guidance-present": { weight: 2 } },
        },
        safety: { gating: true, gatingThreshold: 50 },
      },
      probes: { "latency.test-suite": { warmup: 1 } },
      waivers: [
        { probeId: "secrets.tracked", location: "x.txt", reason: "fixture", expires: "2026-12-01" },
      ],
      reporters: { default: "human" },
    });
    expect(cfg.gate.mode).toBe("absolute");
    expect(cfg.corpus?.[0]?.version).toBe("1.0.0");
    expect(cfg.dimensions?.context?.probes?.["agent.guidance-present"]?.weight).toBe(2);
    expect(cfg.waivers?.[0]?.expires).toBe("2026-12-01");
  });

  test("rejects wrong version", () => {
    expect(() => validateConfig({ version: 2, gate: { mode: "advisory" } })).toThrow(/version/);
  });

  test("rejects unknown gate mode", () => {
    expect(() => validateConfig({ version: 1, gate: { mode: "loose" } })).toThrow(/gate\/mode/);
  });

  test("rejects unpinned corpus version", () => {
    expect(() =>
      validateConfig({
        version: 1,
        gate: { mode: "advisory" },
        corpus: [{ package: "x", version: "^1.0.0" }],
      }),
    ).toThrow(/pinned/);
  });

  test("rejects waiver with empty reason", () => {
    expect(() =>
      validateConfig({
        version: 1,
        gate: { mode: "advisory" },
        waivers: [{ probeId: "p", location: "x", reason: "  " }],
      }),
    ).toThrow(/reason/);
  });

  test("rejects waiver with malformed expires", () => {
    expect(() =>
      validateConfig({
        version: 1,
        gate: { mode: "advisory" },
        waivers: [{ probeId: "p", location: "x", reason: "r", expires: "Q4" }],
      }),
    ).toThrow(/expires/);
  });

  test("rejects malformed JSON with file-aware error", async () => {
    writeFileSync(join(tmp, CONFIG_FILENAME), "{not json");
    await expect(loadProjectConfig(tmp)).rejects.toThrow(/failed to parse/);
  });
});
