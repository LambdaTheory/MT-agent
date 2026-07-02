import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { dailyMissionArtifactPath, type DailyMissionArtifactName } from './dailyMissionArtifacts.js';
import { collectDailyMissionContext, type CollectedContext, type ContextCollector } from './dailyMissionContext.js';
import type { DecisionBuilder } from './decisionBuilder.js';
import { classifyDecisions, type ClassifiedDecisions } from './decisionPolicy.js';
import type { DecisionRecord } from './decisionRecord.js';
import {
  addDailyMissionArtifact,
  createDailyMissionRun,
  isDailyMissionTerminalStatus,
  saveDailyMissionRun,
  transitionDailyMissionRun,
  type DailyMissionRun,
  type DailyMissionRunTrigger,
} from './dailyMissionRun.js';
import { recordOperationEvent } from './operationLedger.js';
import type { OperationSubject } from './operationPlan.js';

export interface RunDailyMissionPlanInput {
  outputDir: string;
  date: string;
  runId: string;
  trigger: DailyMissionRunTrigger;
  collectors: ContextCollector[];
  decisionBuilder: DecisionBuilder;
}

export interface RunDailyMissionPlanResult {
  run: DailyMissionRun;
  context: CollectedContext;
  decisions: DecisionRecord[];
  classified: ClassifiedDecisions;
}

async function writeArtifact(
  outputDir: string,
  date: string,
  artifactName: DailyMissionArtifactName,
  value: unknown,
): Promise<string> {
  const path = dailyMissionArtifactPath(outputDir, date, artifactName);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return path;
}

function runSubject(date: string): OperationSubject {
  return { kind: 'link', id: `daily-mission:${date}` };
}

async function saveFailedRun(outputDir: string, run: DailyMissionRun, at: string): Promise<void> {
  if (isDailyMissionTerminalStatus(run.status)) return;
  try {
    await saveDailyMissionRun(outputDir, transitionDailyMissionRun(run, 'failed', at));
  } catch (error) {
    console.warn('Failed to persist failed DailyMissionRun state.', error);
  }
}

export async function runDailyMissionPlan(input: RunDailyMissionPlanInput): Promise<RunDailyMissionPlanResult> {
  let eventIndex = 0;
  const now = () => new Date().toISOString();
  const eventAt = () => `${input.date}T00:00:${String(eventIndex++).padStart(2, '0')}.000Z`;
  const subject = runSubject(input.date);
  let run = createDailyMissionRun({
    runId: input.runId,
    date: input.date,
    trigger: input.trigger,
    startedAt: now(),
  });

  try {
    run = await saveDailyMissionRun(input.outputDir, run);
    const context = await collectDailyMissionContext(input.collectors, {
      runId: input.runId,
      date: input.date,
      outputDir: input.outputDir,
    });
    const contextPath = await writeArtifact(input.outputDir, input.date, 'collectedContext', context);
    run = addDailyMissionArtifact(run, { type: 'collectedContext', path: contextPath });
    run = await saveDailyMissionRun(input.outputDir, run);
    await recordOperationEvent(input.outputDir, {
      planId: input.runId,
      at: eventAt(),
      event: 'data_collected',
      runId: input.runId,
      decisionId: `${input.runId}:data_collected`,
      subject,
    });

    run = transitionDailyMissionRun(run, 'planning', now());
    run = await saveDailyMissionRun(input.outputDir, run);
    const decisions = await input.decisionBuilder.build(context);
    const decisionsPath = await writeArtifact(input.outputDir, input.date, 'decisions', decisions);
    run = addDailyMissionArtifact(run, { type: 'decisions', path: decisionsPath });
    run = await saveDailyMissionRun(input.outputDir, run);
    for (const decision of decisions) {
      await recordOperationEvent(input.outputDir, {
        planId: decision.decisionId,
        at: eventAt(),
        event: 'decision_created',
        runId: input.runId,
        decisionId: decision.decisionId,
        subject: decision.subjects[0],
      });
    }

    const classified = classifyDecisions(decisions);
    const approvalPath = await writeArtifact(input.outputDir, input.date, 'approvalRequest', classified);
    run = addDailyMissionArtifact(run, { type: 'approvalRequest', path: approvalPath });
    run = transitionDailyMissionRun(run, 'waiting_approval', now());
    run = await saveDailyMissionRun(input.outputDir, run);
    for (const decision of classified.approvals) {
      await recordOperationEvent(input.outputDir, {
        planId: decision.decisionId,
        at: eventAt(),
        event: 'approval_requested',
        runId: input.runId,
        decisionId: decision.decisionId,
        subject: decision.subjects[0],
      });
    }

    return { run, context, decisions, classified };
  } catch (error) {
    await saveFailedRun(input.outputDir, run, now());
    throw error;
  }
}
