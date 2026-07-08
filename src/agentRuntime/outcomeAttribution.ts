import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { dailyMissionArtifactPath } from './dailyMissionArtifacts.js';
import { loadAllExecutionResults } from './dailyMissionExecution.js';
import { recordOperationEvent } from './operationLedger.js';
import type { OperationSubject } from './operationPlan.js';

export interface MetricSnapshot {
  exposure?: number;
  sales?: number;
}

export type OutcomeStatus = 'positive' | 'neutral' | 'negative' | 'pending';

export interface OutcomeRecord {
  decisionId: string;
  runId: string;
  operationType: string;
  subject: OperationSubject;
  executedAt: string;
  measuredAt: string;
  before: MetricSnapshot;
  after?: MetricSnapshot;
  outcome: OutcomeStatus;
}

type AttributableExecution = {
  runId: string;
  decisionId: string;
  ok: boolean;
  status?: string;
  operationType?: string;
  subject?: OperationSubject;
  executedAt?: string;
  beforeMetric?: MetricSnapshot;
  afterMetric?: MetricSnapshot;
};

function score(metric: MetricSnapshot | undefined): number | null {
  if (!metric) return null;
  return (metric.exposure ?? 0) + (metric.sales ?? 0) * 10;
}

function classifyOutcome(before: MetricSnapshot | undefined, after: MetricSnapshot | undefined): OutcomeStatus {
  const beforeScore = score(before);
  const afterScore = score(after);
  if (beforeScore === null || afterScore === null) return 'pending';
  if (afterScore > beforeScore) return 'positive';
  if (afterScore < beforeScore) return 'negative';
  return 'neutral';
}

export async function attributeOutcomes(outputDir: string, missionDate: string, lookaheadDays: number): Promise<OutcomeRecord[]> {
  const results = (await loadAllExecutionResults(outputDir, missionDate)) as AttributableExecution[];
  const measuredAt = new Date(`${missionDate}T00:00:00.000Z`);
  measuredAt.setUTCDate(measuredAt.getUTCDate() + lookaheadDays);
  const afterDate = measuredAt.toISOString().slice(0, 10);
  const records: OutcomeRecord[] = await Promise.all(results
    .filter((result) => result.ok && (result.status ?? 'executed') === 'executed')
    .map(async (result) => {
      const subject = result.subject ?? { kind: 'link' as const, id: `daily-mission:${missionDate}` };
      const after = result.afterMetric ?? await loadSubjectMetric(outputDir, afterDate, subject.id);
      return {
        decisionId: result.decisionId,
        runId: result.runId,
        operationType: result.operationType ?? 'unknown',
        subject,
        executedAt: result.executedAt ?? `${missionDate}T00:00:00.000Z`,
        measuredAt: measuredAt.toISOString(),
        before: result.beforeMetric ?? {},
        ...(after ? { after } : {}),
        outcome: classifyOutcome(result.beforeMetric, after),
      };
    }));
  const path = dailyMissionArtifactPath(outputDir, missionDate, 'outcomes');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  for (const record of records.filter((item) => item.outcome !== 'pending')) {
    await recordOperationEvent(outputDir, {
      planId: record.decisionId,
      at: `${missionDate}T00:00:00.000Z`,
      event: 'outcome_attributed',
      runId: record.runId,
      decisionId: record.decisionId,
      subject: record.subject,
      metadata: { missionDate, measuredAt: record.measuredAt, outcome: record.outcome },
    });
  }
  return records;
}

async function loadSubjectMetric(outputDir: string, date: string, subjectId: string): Promise<MetricSnapshot | undefined> {
  try {
    const parsed = JSON.parse(await readFile(join(outputDir, date, 'report-context.json'), 'utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { rows?: unknown[] }).rows)) return undefined;
    const row = (parsed as { rows: Array<Record<string, unknown>> }).rows.find((item) => item.productId === subjectId || item.internalProductId === subjectId || item.platformProductId === subjectId);
    if (!row) return undefined;
    const exposure = typeof row.exposure === 'number' ? row.exposure : undefined;
    const salesValue = row.sales ?? row.signedOrders ?? row.createdOrders;
    const sales = typeof salesValue === 'number' ? salesValue : undefined;
    return exposure === undefined && sales === undefined ? undefined : { ...(exposure !== undefined ? { exposure } : {}), ...(sales !== undefined ? { sales } : {}) };
  } catch {
    return undefined;
  }
}
