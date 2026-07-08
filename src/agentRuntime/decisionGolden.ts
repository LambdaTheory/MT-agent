import type { CollectedContext } from './dailyMissionContext.js';
import type { DecisionBuilder } from './decisionBuilder.js';

export interface GoldenCase {
  name: string;
  context: CollectedContext;
  expect: {
    minDecisions?: number;
    recommendation?: string;
    operationType?: string;
  };
}

export interface GoldenFailure {
  name: string;
  reason: string;
}

export async function evaluateDecisionGolden(
  builder: DecisionBuilder,
  cases: GoldenCase[],
): Promise<{ passed: number; failed: GoldenFailure[] }> {
  const failed: GoldenFailure[] = [];
  for (const item of cases) {
    const decisions = await builder.build(item.context);
    if (item.expect.minDecisions !== undefined && decisions.length < item.expect.minDecisions) {
      failed.push({ name: item.name, reason: `decisions ${decisions.length} < ${item.expect.minDecisions}` });
      continue;
    }
    if (item.expect.recommendation && !decisions.some((decision) => decision.recommendation === item.expect.recommendation)) {
      failed.push({ name: item.name, reason: `no decision with recommendation ${item.expect.recommendation}` });
      continue;
    }
    if (item.expect.operationType && !decisions.some((decision) => decision.operationType === item.expect.operationType)) {
      failed.push({ name: item.name, reason: `no decision with operationType ${item.expect.operationType}` });
    }
  }
  return { passed: cases.length - failed.length, failed };
}
