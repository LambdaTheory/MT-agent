import { pathToFileURL } from 'node:url';
import { loadApprovalRequest } from '../agentRuntime/dailyMissionApprovalStore.js';
import { loadAllExecutionResults } from '../agentRuntime/dailyMissionExecution.js';
import { loadDailyMissionRun } from '../agentRuntime/dailyMissionRun.js';
import { loadOperationLedgerJsonlEntries } from '../agentRuntime/operationLedger.js';
import { loadEnv } from '../config/loadEnv.js';

export interface DailyMissionAuditSummary {
  date: string;
  status: string;
  events: string[];
  approvals: string[];
  executions: string[];
  decisions: Array<{ decisionId: string; recommendation?: string; subject?: string; status: string }>;
  eventCounts: Record<string, number>;
  lines: string[];
}

function executionStatus(entry: { ok: boolean; status?: string }): string {
  return entry.status ?? (entry.ok ? 'executed' : 'failed');
}

function readArg(argv: string[], name: string): string | undefined {
  const flagIndex = argv.indexOf(name);
  if (flagIndex >= 0) return argv[flagIndex + 1];
  return argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

export async function buildDailyMissionAuditSummary(
  outputDir: string,
  date: string,
): Promise<DailyMissionAuditSummary> {
  const entries = await loadOperationLedgerJsonlEntries(outputDir, date);
  const run = await loadDailyMissionRun(outputDir, date);
  const approvalRequest = await loadApprovalRequest(outputDir, date);
  const executionResults = await loadAllExecutionResults(outputDir, date);
  const eventCounts: Record<string, number> = {};
  for (const entry of entries) eventCounts[entry.event] = (eventCounts[entry.event] ?? 0) + 1;
  const events = entries.map((entry) => entry.event);
  const approvals = entries
    .filter((entry) => entry.event === 'approval_requested')
    .map((entry) => entry.decisionId ?? entry.planId);
  const executions = entries
    .filter((entry) => entry.event.startsWith('execution_'))
    .map((entry) => entry.decisionId ?? entry.planId);
  const executedCount = executionResults.filter((entry) => executionStatus(entry) === 'executed').length;
  const pendingCount = executionResults.filter((entry) => entry.status === 'pending_confirmation').length;
  const failedCount = executionResults.filter((entry) => executionStatus(entry) === 'failed').length;
  const executionStatusByDecision = new Map(executionResults.map((entry) => [entry.decisionId, executionStatus(entry)]));
  const decisions = (approvalRequest?.approvals ?? []).map((decision) => ({
    decisionId: decision.decisionId,
    recommendation: decision.recommendation,
    subject: decision.subjects?.map((subject) => `${subject.kind}:${subject.id}`).join(', '),
    status: executionStatusByDecision.get(decision.decisionId) ?? 'pending',
  }));
  const lines = [
    `Daily Mission 审计：${date}`,
    `状态：${run?.status ?? '无 run'}`,
    `事件总数：${entries.length}`,
    `审批请求：${approvals.length}`,
    `执行事件：${executions.length}`,
    `决策汇总：待审批 ${approvalRequest?.approvals.length ?? 0} | 观察 ${approvalRequest?.observations.length ?? 0} | 已执行 ${executedCount} | 待二次确认 ${pendingCount} | 失败 ${failedCount}`,
    ...decisions.map((decision) => `- ${decision.decisionId}：${decision.status}${decision.subject ? `（${decision.subject}）` : ''}`),
    ...Object.entries(eventCounts).map(([event, count]) => `- ${event}: ${count}`),
  ];
  return { date, status: run?.status ?? 'none', events, approvals, executions, decisions, eventCounts, lines };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  await loadEnv();
  const outputDir = readArg(argv, '--output-dir') ?? process.env.MT_AGENT_OUTPUT_DIR ?? 'output';
  const date = readArg(argv, '--date') ?? new Date().toISOString().slice(0, 10);
  const summary = await buildDailyMissionAuditSummary(outputDir, date);
  console.log(summary.lines.join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
