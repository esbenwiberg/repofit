import { defineProbe } from "@esbenwiberg/repofit/sdk";

const CANONICAL_SECTIONS = [
  /^#+\s+(install|setup|getting started)/im,
  /^#+\s+(usage|quickstart)/im,
  /^#+\s+build/im,
  /^#+\s+test/im,
  /^#+\s+(architecture|design|overview)/im,
  /^#+\s+contribut/im,
  /^#+\s+license/im,
];

export default defineProbe({
  id: "docs.readme-substance",
  version: "0.0.0",
  dimensions: [{ id: "context", weight: 1 }],
  tier: "static",
  evidence: ["files"],

  rationale: `
    A README that touches the canonical sections (install / usage / build /
    test / architecture / contributing / license) gives the agent a route
    to every common question. Stub READMEs that only describe the
    project's name don't.
  `,

  async detect(ev) {
    const raw = await ev.files.readText("README.md");
    if (raw === undefined) return { kind: "na", reason: "no README.md" };
    let count = 0;
    for (const pattern of CANONICAL_SECTIONS) {
      if (pattern.test(raw)) count += 1;
    }
    return { kind: "count", value: count };
  },

  score: {
    kind: "count",
    direction: "positive",
    bands: [{ upTo: 1, score: 20 }, { upTo: 3, score: 50 }, { upTo: 5, score: 80 }, { score: 100 }],
  },

  fixtures: [
    {
      name: "no-readme",
      evidence: { files: [] },
      expect: { reading: { kind: "na", reason: "no README.md" }, score: null },
    },
    {
      name: "stub-readme",
      evidence: { files: { "README.md": "# my-project\n\nA cool thing.\n" } },
      expect: { reading: { kind: "count", value: 0 }, score: 20 },
    },
    {
      name: "rich-readme",
      evidence: {
        files: {
          "README.md":
            "# proj\n## Install\n## Usage\n## Build\n## Test\n## Architecture\n## Contributing\n## License\n",
        },
      },
      expect: { reading: { kind: "count", value: 7 }, score: 100 },
    },
  ],
});
