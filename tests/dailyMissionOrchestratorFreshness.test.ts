import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDailyMissionPlan } from '../src/agentRuntime/dailyMissionOrchestrator.js';
import type { ContextCollector } from '../src/agentRuntime/dailyMissionContext.js';
import type { DecisionRecord } from '../src/agentRuntime/decisionRecord.js';
import { loadOperationLedgerJsonlEntries } from '../src/agentRuntime/operationLedger.js';

const decisionBuilder = {
  build: async (): Promise<DecisionRecord[]> => {
    throw new Error('planner must not run on stale data');
  },
};

function staleCollectors(): ContextCollector[] {
  return [
    { name: 'exposure', collect: async () => { throw new Error('no data'); } },
    { name: 'sales', collect: async () => { throw new Error('no data'); } },
  ];
}

describe('daily mission freshness gate', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-fresh-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('skips planning and produces no approvals when data is stale', async () => {
    const result = await runDailyMissionPlan({
      outputDir: dir,
      date: '2026-07-03',
      runId: 'run-1',
      trigger: 'scheduled',
      collectors: staleCollectors(),
      decisionBuilder,
    });

    expect(result.run.status).toBe('skipped_stale_data');
    expect(result.decisions).toEqual([]);
    expect(result.classified.approvals).toEqual([]);
    expect(result.classified.observations).toEqual([]);

    const files = await readdir(join(dir, 'daily-mission', '2026-07-03'));
    expect(files).toContain('collected-context.json');
    expect(files).toContain('daily-journal.json');
    expect(files).not.toContain('decisions.json');
    expect(files).not.toContain('approval-request.json');

    const journal = JSON.parse(await readFile(join(dir, 'daily-mission', '2026-07-03', 'daily-journal.json'), 'utf8')) as {
      failure?: { stage?: string; message?: string };
    };
    expect(journal.failure?.stage).toBe('freshness_gate');
    expect(journal.failure?.message).toContain('exposure_missing');
    expect(journal.failure?.message).toContain('sales_missing');

    const events = (await loadOperationLedgerJsonlEntries(dir, '2026-07-03')).map((entry) => entry.event);
    expect(events).toContain('data_collected');
    expect(events).toContain('data_not_ready');
    expect(events).toContain('journal_written');
    expect(events).not.toContain('decision_created');
    expect(events).not.toContain('approval_requested');
  });
});
