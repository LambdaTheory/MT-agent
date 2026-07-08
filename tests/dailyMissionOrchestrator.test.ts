import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDailyMissionPlan } from '../src/agentRuntime/dailyMissionOrchestrator.js';
import { RuleBasedDecisionBuilder } from '../src/agentRuntime/decisionBuilder.js';
import type { ContextCollector } from '../src/agentRuntime/dailyMissionContext.js';
import type { DecisionBuilder } from '../src/agentRuntime/decisionBuilder.js';
import { loadOperationLedgerJsonlEntries } from '../src/agentRuntime/operationLedger.js';

function freshDataCollectors(date = '2026-07-01'): ContextCollector[] {
  return [
    { name: 'exposure', collect: async () => ({ exposure: { context: { date, rows: [{ id: '1' }] } } }) },
    { name: 'sales', collect: async () => ({ sales: { date } }) },
  ];
}

describe('runDailyMissionPlan', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-orch-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('runs collect-plan-waiting_approval and writes artifacts plus events without execution', async () => {
    const collectors: ContextCollector[] = [
      ...freshDataCollectors(),
      {
        name: 'hotspots',
        collect: async () => ({
          hotspots: [
            {
              eventId: 'e1',
              source: 'manual',
              title: '演唱会A',
              startsAt: '2026-07-03T00:00:00.000Z',
              affectedCategories: ['相机'],
              confidence: 'high',
            },
          ],
        }),
      },
    ];

    const result = await runDailyMissionPlan({
      outputDir: dir,
      date: '2026-07-01',
      runId: 'run-1',
      trigger: 'manual',
      collectors,
      decisionBuilder: new RuleBasedDecisionBuilder(),
    });

    expect(result.run.status).toBe('waiting_approval');
    expect(result.decisions).toHaveLength(1);
    expect(result.classified.observations).toHaveLength(1);

    const contextRaw = await readFile(join(dir, 'daily-mission', '2026-07-01', 'collected-context.json'), 'utf8');
    expect(JSON.parse(contextRaw).runId).toBe('run-1');
    await readFile(join(dir, 'daily-mission', '2026-07-01', 'decisions.json'), 'utf8');
    await readFile(join(dir, 'daily-mission', '2026-07-01', 'approval-request.json'), 'utf8');

    const events = (await loadOperationLedgerJsonlEntries(dir, '2026-07-01')).map((entry) => entry.event);
    expect(events).toContain('data_collected');
    expect(events).toContain('decision_created');
    expect(events).not.toContain('approval_requested');
    expect(events).not.toContain('execution_started');
  });

  it('records approval_requested only for executable approvals', async () => {
    const builder: DecisionBuilder = {
      build: async (context) => ([{
        decisionId: 'dec-1',
        runId: context.runId,
        title: '审批执行',
        subjects: [{ kind: 'product', id: '648' }],
        operationType: 'price_down',
        recommendation: 'approve_to_execute',
        risk: 'write',
        rationale: ['证据充分'],
        evidenceRefs: ['manual'],
        proposedTool: { toolName: 'rental.pricePreview', arguments: { productIds: ['648'] } },
        uncertainties: [],
      }]),
    };

    await runDailyMissionPlan({
      outputDir: dir,
      date: '2026-07-01',
      runId: 'run-1',
      trigger: 'manual',
      collectors: freshDataCollectors(),
      decisionBuilder: builder,
    });

    const entries = await loadOperationLedgerJsonlEntries(dir, '2026-07-01');
    const approval = entries.find((entry) => entry.event === 'approval_requested');
    expect(approval?.decisionId).toBe('dec-1');
    expect(approval?.subject).toEqual({ kind: 'product', id: '648' });
    const approvalRequest = JSON.parse(await readFile(join(dir, 'daily-mission', '2026-07-01', 'approval-request.json'), 'utf8')) as {
      approvalCards?: unknown[];
    };
    expect(approvalRequest.approvalCards).toHaveLength(1);
    expect(JSON.stringify(approvalRequest.approvalCards?.[0])).toContain('agent_tool_confirm');
    expect(JSON.stringify(approvalRequest.approvalCards?.[0])).toContain('confirmationKey');
  });
});
