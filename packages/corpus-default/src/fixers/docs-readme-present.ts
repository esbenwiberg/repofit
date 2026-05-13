import { defineFixer } from "@esbenwiberg/repofit/sdk";

const README_SCAFFOLD = `# {{name}}

> One-sentence description.

## Install

\`\`\`bash
# package manager install command
\`\`\`

## Usage

\`\`\`bash
# the simplest command that demonstrates the tool
\`\`\`

## Development

\`\`\`bash
# install, build, test
\`\`\`

## License

TBD.
`;

export default defineFixer({
  probeId: "docs.readme-present",
  mode: "static",
  describe: "scaffold README.md",
  async plan({ cwd }) {
    const name = cwd.split("/").filter(Boolean).pop() ?? "project";
    const content = README_SCAFFOLD.replace("{{name}}", name);
    return {
      actions: [{ kind: "write-file", path: "README.md", content, ifMissing: true }],
      notes: ["fill in install, usage, and license before publishing"],
    };
  },
});
