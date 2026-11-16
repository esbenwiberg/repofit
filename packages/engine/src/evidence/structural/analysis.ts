import { candidateFindings, groupPackets, judgePackets } from "./discovery.js";
import { runExperiments } from "./experiments.js";
import { buildIndex, loadIndex } from "./indexer.js";
import { assessPolicies, discoverBypasses, loadPolicy } from "./policies.js";
import { assessReadiness } from "./readiness.js";
import {
  type AnalysisOptions,
  type AnalysisReport,
  GROUP_VERSION,
  INDEX_VERSION,
  PROMPT_VERSION,
  RULE_VERSION,
} from "./types.js";

export async function analyzeRepository(
  cwd: string,
  options: AnalysisOptions = {},
): Promise<AnalysisReport> {
  const [previous, declaration, readiness] = await Promise.all([
    loadIndex(cwd),
    loadPolicy(cwd),
    assessReadiness(cwd),
  ]);
  const index = await buildIndex(cwd, previous, options.rehash);
  const grouped = groupPackets(index, declaration.policy);
  const known = assessPolicies(index, declaration.policy);
  const bypasses = discoverBypasses(index, declaration.policy);
  const findings = options.judge
    ? await judgePackets(grouped.packets, options.judge)
    : candidateFindings(grouped.packets);
  return {
    version: 1,
    advisory: true,
    versions: {
      index: INDEX_VERSION,
      grouping: GROUP_VERSION,
      rules: RULE_VERSION,
      prompt: PROMPT_VERSION,
    },
    index,
    policy: {
      configured: !!declaration.policy,
      findings: [...known, ...bypasses],
      unknowns: declaration.unknowns,
      experiments: options.experiment
        ? await runExperiments(cwd, declaration.policy, index)
        : (declaration.policy?.experiments ?? []).map((e) => ({
            id: e.id,
            configured: true,
            executed: false,
            acceptsLegitimate: null,
            rejectsInvalid: null,
            reason: "Not run: explicit analyze --experiment required.",
            executions: [],
          })),
    },
    discovery: {
      ...grouped,
      findings,
      unknowns: [
        "Candidate groups are open-ended heuristic similarities, not a taxonomy or proof of correctness. Consistently bad practices need a declared policy or independent behavioral evidence.",
        ...(options.judge
          ? ["Judge findings are advisory interpretations, not execution proof."]
          : ["Reasoned review not requested; no model was invoked."]),
      ],
    },
    readiness,
  };
}
