import type { AgentToolConfirmRequest } from './approvalCard.js';
import { parseDailyMissionReason } from './dailyMissionApproval.js';
import { recordOperationEvent } from './operationLedger.js';

function inferProductId(args: Record<string, unknown>): string {
  if (typeof args.productId === 'string' && args.productId.trim()) return args.productId.trim();
  if (Array.isArray(args.productIds) && typeof args.productIds[0] === 'string' && args.productIds[0].trim()) return args.productIds[0].trim();
  return 'unknown';
}

export async function recordDailyMissionRejection(
  request: Pick<AgentToolConfirmRequest, 'toolName' | 'arguments' | 'reason'>,
  outputDir: string,
): Promise<boolean> {
  const tag = parseDailyMissionReason(request.reason);
  if (!tag) return false;
  await recordOperationEvent(outputDir, {
    planId: tag.decisionId,
    at: new Date().toISOString(),
    event: 'approval_rejected',
    runId: tag.runId,
    decisionId: tag.decisionId,
    toolName: request.toolName,
    subject: { kind: 'product', id: inferProductId(request.arguments) },
  });
  return true;
}
