import { analyzeRepository } from "../evidence/structural/analysis.js";
import { saveIndex } from "../evidence/structural/indexer.js";
import { judgeSubsystem } from "../evidence/subsystems/judge.js";
import type { JudgeOptions } from "../sdk/types.js";

export async function analyze(options: {
  cwd: string;
  judge?: boolean;
  experiment?: boolean;
  rehash?: boolean;
  cache?: boolean;
  judgeTransport?: JudgeOptions["transport"];
  model?: string;
}): Promise<string> {
  const report = await analyzeRepository(options.cwd, {
    rehash: options.rehash || options.cache === false,
    experiment: options.experiment,
    ...(options.judge
      ? {
          judge: judgeSubsystem.gather({
            cwd: options.cwd,
            judge: {
              noCache: options.cache === false,
              transport: options.judgeTransport,
              model: options.model,
            },
          }),
        }
      : {}),
  });
  if (options.cache !== false) await saveIndex(options.cwd, report.index);
  return `${JSON.stringify(report, null, 2)}\n`;
}
