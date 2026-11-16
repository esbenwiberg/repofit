import { defineProbe } from "@esbenwiberg/repofit/sdk";
export default defineProbe({
  id: "arch.declared-policy-assessment",
  version: "1.0.0",
  dimensions: [{ id: "safety", weight: 1 }],
  tier: "derived",
  optIn: true,
  evidence: ["repo_analysis"],
  rationale:
    "Declared scoped policies produce lexical diagnostic evidence, not inferred conventions.",
  remediation:
    "Use repofit analyze to inspect related rule locations and syntax limitations; assess actual risk and use scoped waivers when justified.",
  async detect(ev) {
    if (!ev.repo_analysis) return { kind: "na", reason: "analysis evidence unavailable" };
    const report = await ev.repo_analysis.inspect();
    if (!report.policy.configured) return { kind: "na", reason: "no valid declared policy" };
    return {
      kind: "inventory",
      items: report.policy.findings
        .filter((f) => f.kind === "policy")
        .map(({ location, severity, message, relatedLocations }) => ({
          location,
          severity,
          message,
          relatedLocations,
        })),
    };
  },
  score: {
    kind: "inventory",
    severityWeights: { info: 1, warn: 3, error: 10 },
    bands: [{ upTo: 0, score: 100 }, { upTo: 1, score: 90 }, { upTo: 3, score: 70 }, { score: 0 }],
  },
  fixtures: [
    {
      name: "unavailable",
      evidence: {},
      expect: { reading: { kind: "na", reason: "analysis evidence unavailable" }, score: null },
    },
    {
      name: "clean",
      evidence: { repo_analysis: { policy: { configured: true, findings: [] } } },
      expect: { reading: { kind: "inventory", items: [] }, score: 100 },
    },
    {
      name: "diagnostic",
      evidence: {
        repo_analysis: {
          policy: {
            configured: true,
            findings: [
              {
                kind: "policy",
                confidence: "deterministic",
                location: { path: "src/example.ts" },
                relatedLocations: [],
                severity: "warn",
                message: "Lexical restricted-call match",
              },
            ],
          },
        },
      },
      expect: {
        reading: {
          kind: "inventory",
          items: [
            {
              location: { path: "src/example.ts" },
              relatedLocations: [],
              severity: "warn",
              message: "Lexical restricted-call match",
            },
          ],
        },
        score: 70,
      },
    },
  ],
});
