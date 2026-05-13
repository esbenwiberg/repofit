import { fileExists } from "@esbenwiberg/repofit/sdk/recipes";

export default fileExists({
  id: "docs.readme-present",
  version: "1.0.0",
  dimensions: [{ id: "context", weight: 1 }],
  rationale: `
    A README is the canonical entry point for any human or agent landing in
    a repo. Without one, the agent must infer the project's purpose, build
    steps, and conventions from incidental signals (filenames, dependencies,
    git history) — slower and unreliable.
  `,
  remediation:
    "Add a `README.md` at the repo root. Cover what the project does, how to install/build/run, and where to find more docs. A short README beats no README.",
  path: "README.md",
});
