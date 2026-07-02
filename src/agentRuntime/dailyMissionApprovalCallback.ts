import type { AgentToolExecutionOptions } from '../feishuBot/agentToolExecutor.js';
import type { AgentToolConfirmRequest } from './approvalCard.js';
import { parseDailyMissionReason } from './dailyMissionApproval.js';
import { appendExecutionResult, executeApprovedDecision, type DailyMissionExecutionResult } from './dailyMissionExecution.js';
import type { DecisionRecord } from './decisionRecord.js';
import { findDailyMissionRunByRunId } from './dailyMissionRun.js';

function inferProductId(args: Record<string, unknown>): string {
  if (typeof args.productId === 'string' && args.productId.trim()) return args.productId.trim();
  if (Array.isArray(args.productIds) && typeof args.productIds[0] === 'string' && args.productIds[0].trim()) return args.productIds[0].trim();
  return 'unknown';
}

export async function resolveDailyMissionApproval(
  request: AgentToolConfirmRequest,
  outputDir: string,
  options?: AgentToolExecutionOptions,
): Promise<DailyMissionExecutionResult | null> {
  const tag = parseDailyMissionReason(request.reason);
  if (!tag) return null;
  const run = await findDailyMissionRunByRunId(outputDir, tag.runId);
  if (!run) throw new Error(`Daily Mission run not found for ${tag.runId}`);
  const decision: DecisionRecord = {
    decisionId: tag.decisionId,
    runId: tag.runId,
    title: request.reason,
    subjects: [{ kind: 'product', id: inferProductId(request.arguments) }],
    operationType: request.toolName === 'rental.delist' ? 'delist' : 'observe',
    recommendation: 'approve_to_execute',
    risk: 'high',
    rationale: [],
    evidenceRefs: ['approval.callback'],
    uncertainties: [],
    proposedTool: { toolName: request.toolName, arguments: request.arguments },
  };
  const result = await executeApprovedDecision({ decision, outputDir, options });
  await appendExecutionResult(outputDir, run.date, result);
  return result;
}
