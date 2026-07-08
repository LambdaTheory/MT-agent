import type { AgentToolConfirmRequest } from '../agentRuntime/approvalCard.js';
import type { RentalWriteLedgerContext } from './rentalWriteOperationHandlers.js';

export function agentExploreLedgerContextFromRequest(
  request: AgentToolConfirmRequest,
  outputDir: string,
): RentalWriteLedgerContext | undefined {
  const match = /^agentExplore:([^\s]+)(?:\s|$)/.exec(request.reason);
  if (!match) return undefined;
  try {
    const decisionId = JSON.parse(decodeURIComponent(match[1])) as unknown;
    return typeof decisionId === 'string' ? { outputDir, runId: 'agentExplore', decisionId } : undefined;
  } catch {
    return undefined;
  }
}

export function agentExploreReason(decisionId: string, title: string): string {
  return `agentExplore:${encodeURIComponent(JSON.stringify(decisionId))} ${title}`;
}
