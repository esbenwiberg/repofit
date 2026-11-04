import { describe, expect, it } from "vitest";
import { parseLog } from "../src/evidence/subsystems/commit-history.js";

const RS = "\x1e";
const FS = "\x1f";

describe("commit-history parseLog", () => {
  it("attaches each commit's touched paths and keeps the header fields", () => {
    const raw = [
      `aaa${FS}feat(x): add y${FS}a@b${RS}`,
      "src/a.ts",
      "src/b.ts",
      "",
      `bbb${FS}fix: bug${FS}c@d${RS}`,
      "src/a.ts",
      "",
      `ccc${FS}docs: readme${FS}e@f${RS}`,
    ].join("\n");
    expect(parseLog(raw)).toEqual([
      {
        sha: "aaa",
        subject: "feat(x): add y",
        authorEmail: "a@b",
        files: ["src/a.ts", "src/b.ts"],
      },
      { sha: "bbb", subject: "fix: bug", authorEmail: "c@d", files: ["src/a.ts"] },
      { sha: "ccc", subject: "docs: readme", authorEmail: "e@f", files: [] },
    ]);
  });

  it("handles a log without path lists (no --name-only)", () => {
    const raw = `aaa${FS}one${FS}a@b${RS}\nbbb${FS}two${FS}a@b${RS}`;
    expect(parseLog(raw).map((c) => [c.sha, c.subject, c.files])).toEqual([
      ["aaa", "one", []],
      ["bbb", "two", []],
    ]);
  });

  it("returns nothing for empty output", () => {
    expect(parseLog("")).toEqual([]);
  });
});
