import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { dailyMissionArtifactPath } from './dailyMissionArtifacts.js';
import type { CollectedContext } from './dailyMissionContext.js';
import type { ClassifiedDecisions } from './decisionPolicy.js';
import type { DecisionRecord } from './decisionRecord.js';
import { recordOperationEvent } from './operationLedger.js';

export interface WriteDailyJournalInput {
  outputDir: string;
  date: string;
  runId: string;
  context: CollectedContext;
  decisions: DecisionRecord[];
  classified: ClassifiedDecisions;
}

export interface DailyJournalPaths {
  jsonPath: string;
  markdownPath: string;
}

function renderMarkdown(input: WriteDailyJournalInput): string {
  const missingSources = input.context.missingSources.length > 0 ? input.context.missingSources.join('、') : '无';
  const hotspots = (input.context.hotspots ?? []).map((event) => event.title).join('、') || '无';
  const observations = input.classified.observations.map((decision) => (
    `- ${decision.title}${decision.blockedReason ? `（${decision.blockedReason}）` : ''}`
  ));
  const approvals = input.classified.approvals.map((decision) => (
    `- ${decision.title}${decision.proposedTool ? ` -> ${decision.proposedTool.toolName}` : ''}`
  ));
  return [
    `# 运营日报 ${input.date}`,
    '',
    `- 缺失数据源：${missingSources}`,
    `- 热点事件：${hotspots}`,
    `- 待审批执行项：${input.classified.approvals.length}`,
    `- 观察项：${input.classified.observations.length}`,
    '',
    '## 观察项',
    ...(observations.length > 0 ? observations : ['- 无']),
    '',
    '## 待审批执行项',
    ...(approvals.length > 0 ? approvals : ['- 无']),
  ].join('\n');
}

export async function writeDailyJournal(input: WriteDailyJournalInput): Promise<DailyJournalPaths> {
  const jsonPath = dailyMissionArtifactPath(input.outputDir, input.date, 'dailyJournalJson');
  const markdownPath = dailyMissionArtifactPath(input.outputDir, input.date, 'dailyJournalMarkdown');
  await mkdir(dirname(jsonPath), { recursive: true });
  const journal = {
    runId: input.runId,
    date: input.date,
    missingSources: input.context.missingSources,
    decisions: input.decisions,
    approvals: input.classified.approvals.map((decision) => decision.decisionId),
    observations: input.classified.observations.map((decision) => decision.decisionId),
  };
  await writeFile(jsonPath, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, `${renderMarkdown(input)}\n`, 'utf8');
  await recordOperationEvent(input.outputDir, {
    planId: input.runId,
    at: `${input.date}T00:00:00.000Z`,
    event: 'journal_written',
    runId: input.runId,
  });
  return { jsonPath, markdownPath };
}
