import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { dailyMissionArtifactPath, type DailyMissionArtifactName } from './dailyMissionArtifacts.js';
import { collectDailyMissionContext, type CollectedContext, type ContextCollector } from './dailyMissionContext.js';
import { buildDailyMissionApprovalCards } from './dailyMissionApproval.js';
import type { DecisionBuilder } from './decisionBuilder.js';
import { classifyDecisions, type ClassifiedDecisions } from './decisionPolicy.js';
import type { DecisionRecord } from './decisionRecord.js';
import { writeDailyJournal } from './dailyJournalWriter.js';
import { assessDataFreshness, type FreshnessOptions } from './dataFreshnessGate.js';
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
  freshness?: FreshnessOptions;
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
  let stage = 'starting';
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
    stage = 'collecting';
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

    const freshness = assessDataFreshness(context, input.freshness);
    if (!freshness.fresh) {
      await recordOperationEvent(input.outputDir, {
        planId: input.runId,
        at: eventAt(),
        event: 'data_not_ready',
        runId: input.runId,
        decisionId: `${input.runId}:data_not_ready`,
        subject,
      });
      run = transitionDailyMissionRun(run, 'skipped_stale_data', now());
      run = await saveDailyMissionRun(input.outputDir, run);
      const classified: ClassifiedDecisions = { approvals: [], observations: [] };
      await writeDailyJournal({
        outputDir: input.outputDir,
        date: input.date,
        runId: input.runId,
        context,
        decisions: [],
        classified,
        failure: { stage: 'freshness_gate', message: freshness.reasons.join(',') },
      }).catch((journalError) => {
        console.warn('Failed to write stale-data Daily Mission journal.', journalError);
      });
      return { run, context, decisions: [], classified };
    }

    stage = 'planning';
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

    stage = 'waiting_approval';
    const classified = classifyDecisions(decisions);
    const approvalPath = await writeArtifact(input.outputDir, input.date, 'approvalRequest', {
      ...classified,
      approvalCards: buildDailyMissionApprovalCards(classified.approvals),
    });
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
    await writeDailyJournal({
      outputDir: input.outputDir,
      date: input.date,
      runId: input.runId,
      context: { runId: input.runId, date: input.date, outputDir: input.outputDir, collectedAt: now(), missingSources: [] },
      decisions: [],
      classified: { approvals: [], observations: [] },
      failure: { stage, message: error instanceof Error ? error.message : String(error) },
    }).catch((journalError) => {
      console.warn('Failed to write failed Daily Mission journal.', journalError);
    });
    throw error;
  }
}
