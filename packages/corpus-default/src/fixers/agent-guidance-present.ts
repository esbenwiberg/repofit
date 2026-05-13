import { defineFixer } from "@esbenwiberg/repofit/sdk";

const CLAUDE_MD_SCAFFOLD = `# {{name}}

> One-sentence description of what this project is and who it's for.

## Build & Test

\`\`\`bash
# install deps
# build
# test
\`\`\`

## Architecture

A paragraph (or a small diagram) describing the top-level shape: packages,
entrypoints, key modules, and how they relate.

## Conventions

- Commit style: …
- Branching: …
- Code style: see \`.editorconfig\` and lint config.

## Where to find things

| What | Where |
|---|---|
| Tests | … |
| Docs | … |
| Examples | … |
`;

export default defineFixer({
  probeId: "agent.guidance-present",
  mode: "static",
  describe: "scaffold CLAUDE.md",
  async plan({ cwd }) {
    const name = cwd.split("/").filter(Boolean).pop() ?? "project";
    const content = CLAUDE_MD_SCAFFOLD.replace("{{name}}", name);
    return {
      actions: [{ kind: "write-file", path: "CLAUDE.md", content, ifMissing: true }],
      notes: ["edit the scaffold to reflect the actual project before committing"],
    };
  },
});
