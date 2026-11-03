import type { Location } from "@esbenwiberg/repofit/sdk";
import { defineProbe } from "@esbenwiberg/repofit/sdk";

const LINE_THRESHOLD = 2000;
const BYTE_THRESHOLD = 100 * 1024;

/**
 * Binary files are not agent context: no agent reads a PNG preview or a
 * font end-to-end, so their size is storage cost, not token cost. Matched
 * by extension; a binary with an unknown extension still counts.
 */
const BINARY_EXTENSION =
  /\.(?:png|jpe?g|gif|webp|avif|bmp|ico|icns|tiff?|psd|pdf|woff2?|ttf|otf|eot|mp[34]|m4[av]|wav|ogg|flac|webm|mov|avi|mkv|zip|gz|tgz|bz2|xz|7z|rar|jar|war|exe|dll|so|dylib|wasm|bin|dat|db|sqlite3?|pyc|class|o|a|lib|gltf|glb|fbx|blend|lockb)$/i;

export default defineProbe({
  id: "size.large-files",
  version: "1.0.1",
  dimensions: [{ id: "cost", weight: 1 }],
  tier: "derived",
  evidence: ["size_stats"],

  rationale: `
    Large files punish agents twice: they cost more tokens to load and they
    invite "find the relevant 20 lines in this 3000-line file" reasoning
    detours. Counting files past a width threshold surfaces the worst
    offenders. Generated files (lockfiles, files marked
    \`linguist-generated\`) are excluded — they're large by necessity and
    no agent should read them end-to-end. Binary files (images, fonts,
    archives, media) are excluded too: they are never loaded as context, so
    a design preview or a screenshot is storage, not tokens.
  `,

  remediation:
    "Split files over ~2000 lines or ~100KB. Common patterns: extract one cohesive class/module per file, move generated code out of the repo (or store under a `generated/` directory excluded from typical edits), break up monolithic config files. Smaller files mean cheaper agent context and less time spent navigating.",

  async detect(ev) {
    if (ev.size_stats.source === "none") {
      return { kind: "na", reason: "no git working tree" };
    }
    const samples: Location[] = [];
    for (const f of ev.size_stats.files) {
      if (f.generated || BINARY_EXTENSION.test(f.path)) continue;
      if (f.lines > LINE_THRESHOLD || f.bytes > BYTE_THRESHOLD) {
        samples.push({ path: f.path });
      }
    }
    return { kind: "count", value: samples.length, samples };
  },

  score: {
    kind: "count",
    direction: "negative",
    bands: [
      { upTo: 0, score: 100 },
      { upTo: 2, score: 80 },
      { upTo: 5, score: 60 },
      { upTo: 10, score: 30 },
      { score: 0 },
    ],
  },

  fixtures: [
    {
      name: "no-large-files",
      evidence: {
        size_stats: {
          source: "git-ls-files",
          totalBytes: 100,
          totalFiles: 1,
          totalBytesEffective: 100,
          totalFilesEffective: 1,
          files: [{ path: "src/index.ts", bytes: 100, lines: 5, depth: 2, generated: false }],
        },
      },
      expect: { reading: { kind: "count", value: 0, samples: [] }, score: 100 },
    },
    {
      name: "one-giant",
      evidence: {
        size_stats: {
          source: "git-ls-files",
          totalBytes: 5000000,
          totalFiles: 1,
          totalBytesEffective: 5000000,
          totalFilesEffective: 1,
          files: [
            { path: "src/legacy.ts", bytes: 5000000, lines: 3000, depth: 2, generated: false },
          ],
        },
      },
      expect: {
        reading: { kind: "count", value: 1, samples: [{ path: "src/legacy.ts" }] },
        score: 80,
      },
    },
    {
      name: "giant-lockfile-ignored",
      evidence: {
        size_stats: {
          source: "git-ls-files",
          totalBytes: 200000,
          totalFiles: 2,
          totalBytesEffective: 100,
          totalFilesEffective: 1,
          files: [
            { path: "src/index.ts", bytes: 100, lines: 5, depth: 2, generated: false },
            {
              path: "package-lock.json",
              bytes: 199900,
              lines: 5000,
              depth: 1,
              generated: true,
            },
          ],
        },
      },
      expect: { reading: { kind: "count", value: 0, samples: [] }, score: 100 },
    },
    {
      name: "binary-images-ignored",
      evidence: {
        size_stats: {
          source: "git-ls-files",
          totalBytes: 900100,
          totalFiles: 4,
          totalBytesEffective: 900100,
          totalFilesEffective: 4,
          files: [
            { path: "src/index.ts", bytes: 100, lines: 5, depth: 2, generated: false },
            {
              path: "docs/design/direct-planning/previews/01-team-capacity.png",
              bytes: 350000,
              lines: 1400,
              depth: 5,
              generated: false,
            },
            {
              path: "docs/design/demo-harness/evidence/local-closed.PNG",
              bytes: 250000,
              lines: 900,
              depth: 5,
              generated: false,
            },
            { path: "assets/brand.woff2", bytes: 300000, lines: 0, depth: 2, generated: false },
          ],
        },
      },
      expect: { reading: { kind: "count", value: 0, samples: [] }, score: 100 },
    },
    {
      name: "no-evidence",
      evidence: {
        size_stats: {
          source: "none",
          totalBytes: 0,
          totalFiles: 0,
          totalBytesEffective: 0,
          totalFilesEffective: 0,
          files: [],
        },
      },
      expect: { reading: { kind: "na", reason: "no git working tree" }, score: null },
    },
  ],
});
