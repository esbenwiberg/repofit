import { defineProbe } from "@esbenwiberg/repofit/sdk";

export default defineProbe({
  id: "git.branch-protection",
  version: "0.0.0",
  dimensions: [{ id: "safety", weight: 1 }],
  tier: "executed",
  evidence: ["github_api"],

  rationale: `
    External-tier stub. Reports whether the default branch on the
    GitHub remote has branch protection enabled. Needs a GitHub
    remote and a GITHUB_TOKEN (or GH_TOKEN); otherwise N/A. First
    external-tier probe — proves the contract, not every corner case.
  `,

  async detect(ev) {
    const result = await ev.github_api.branchProtection();
    if (result.kind === "unavailable") return { kind: "na", reason: result.reason };
    return { kind: "predicate", value: result.kind === "protected" };
  },

  score: { kind: "predicate", direction: "positive" },

  fixtures: [
    {
      name: "no-token",
      evidence: {
        github_api: {
          branchProtection: { kind: "unavailable", reason: "no GITHUB_TOKEN/GH_TOKEN in env" },
        },
      },
      expect: {
        reading: { kind: "na", reason: "no GITHUB_TOKEN/GH_TOKEN in env" },
        score: null,
      },
    },
    {
      name: "protected",
      evidence: { github_api: { branchProtection: { kind: "protected" } } },
      expect: { reading: { kind: "predicate", value: true }, score: 100 },
    },
    {
      name: "unprotected",
      evidence: { github_api: { branchProtection: { kind: "unprotected" } } },
      expect: { reading: { kind: "predicate", value: false }, score: 0 },
    },
  ],
});
