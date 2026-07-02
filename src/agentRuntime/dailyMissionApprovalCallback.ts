import type { AgentToolExecutionOptions } from '../feishuBot/agentToolExecutor.js';
import type { AgentToolConfirmRequest } from './approvalCard.js';
import { parseDailyMissionReason } from './dailyMissionApproval.js';
import { decisionMatchesRequest, findApprovedDecision, loadApprovalRequest } from './dailyMissionApprovalStore.js';
import { appendExecutionResult, executeApprovedDecision, loadAllExecutionResults, type DailyMissionExecutionResult } from './dailyMissionExecution.js';
import { findDailyMissionRunByRunId, isDailyMissionTerminalStatus, saveDailyMissionRun, transitionDailyMissionRun } from './dailyMissionRun.js';

function executionStatus(result: DailyMissionExecutionResult): DailyMissionExecutionResult['status'] {
  return result.status ?? (result.ok ? 'executed' : 'failed');
}

export async function resolveDailyMissionApproval(
  request: AgentToolConfirmRequest,
  outputDir: string,
  options?: AgentToolExecutionOptions,
): Promise<DailyMissionExecutionResult | null> {
  const tag = parseDailyMissionReason(request.reason);
  if (!tag) return null;
  const run = await findDailyMissionRunByRunId(outputDir, tag.runId);
  if (!run) throw new Error(`Daily Mission run not found: ${tag.runId}`);
  if (isDailyMissionTerminalStatus(run.status)) {
    throw new Error(`Daily Mission run ${tag.runId} is terminal (${run.status}); refusing execution.`);
  }
  if (run.status !== 'waiting_approval' && run.status !== 'executing') {
    throw new Error(`Daily Mission run ${tag.runId} not awaiting approval (${run.status}).`);
  }
  const approval = await loadApprovalRequest(outputDir, run.date);
  if (!approval) throw new Error(`No approval-request for run ${tag.runId} on ${run.date}.`);
  const decision = findApprovedDecision(approval, tag.decisionId);
  if (!decision) throw new Error(`Decision ${tag.decisionId} is not in the approved set for run ${tag.runId}.`);
  if (!decisionMatchesRequest(decision, request.toolName, request.arguments)) {
    throw new Error(`Confirm request does not match approved decision ${tag.decisionId}.`);
  }
  const result = await executeApprovedDecision({ decision, outputDir, date: run.date, options });
  await appendExecutionResult(outputDir, run.date, result);
  const now = new Date().toISOString();
  let advanced = run.status === 'waiting_approval' ? transitionDailyMissionRun(run, 'executing', now) : run;
  const results = await loadAllExecutionResults(outputDir, run.date);
  const pending = results.some((entry) => executionStatus(entry) === 'pending_confirmation');
  const terminalDecisionIds = new Set(results
    .filter((entry) => executionStatus(entry) === 'executed' || executionStatus(entry) === 'failed')
    .map((entry) => entry.decisionId));
  const allApprovedTerminal = approval.approvals.every((item) => terminalDecisionIds.has(item.decisionId));
  if (!pending && allApprovedTerminal) {
    const failedDecisionIds = new Set(results.filter((entry) => executionStatus(entry) === 'failed').map((entry) => entry.decisionId));
    advanced = transitionDailyMissionRun(advanced, approval.approvals.some((item) => failedDecisionIds.has(item.decisionId)) ? 'failed' : 'completed', now);
  }
  await saveDailyMissionRun(outputDir, advanced);
  return result;
}
