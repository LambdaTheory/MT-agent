import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordOperationEvent } from '../src/agentRuntime/operationLedger.js';
import {
  collectDailyMissionContext,
  collectRecentOperations,
  type ContextCollector,
} from '../src/agentRuntime/dailyMissionContext.js';

describe('collectDailyMissionContext', () => {
  const base = { runId: 'run-1', date: '2026-07-01', outputDir: '/tmp/x' };

  it('merges collector outputs into a single context', async () => {
    const collectors: ContextCollector[] = [
      { name: 'exposure', collect: async () => ({ exposure: { summary: 'ok' } }) },
      { name: 'hotspots', collect: async () => ({ hotspots: [] }) },
    ];

    const ctx = await collectDailyMissionContext(collectors, base);

    expect(ctx.runId).toBe('run-1');
    expect(ctx.exposure).toEqual({ summary: 'ok' });
    expect(ctx.hotspots).toEqual([]);
    expect(ctx.missingSources).toEqual([]);
  });

  it('records missingSources when a collector throws', async () => {
    const collectors: ContextCollector[] = [
      { name: 'sales', collect: async () => { throw new Error('boom'); } },
    ];

    const ctx = await collectDailyMissionContext(collectors, base);

    expect(ctx.missingSources).toContain('sales');
  });
});

describe('collectRecentOperations', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-context-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loads operation ledger entries over the lookback window', async () => {
    await recordOperationEvent(dir, {
      planId: 'plan-1',
      at: '2026-06-30T09:00:00.000Z',
      event: 'execution_succeeded',
      runId: 'run-previous',
      decisionId: 'dec-previous',
      subject: { kind: 'product', id: '648' },
    });
    await recordOperationEvent(dir, {
      planId: 'plan-2',
      at: '2026-07-01T09:00:00.000Z',
      event: 'decision_created',
      runId: 'run-current',
      decisionId: 'dec-current',
      subject: { kind: 'product', id: '649' },
    });

    const entries = await collectRecentOperations(dir, '2026-07-01', 2);

    expect(entries.map((entry) => entry.decisionId)).toEqual(['dec-current', 'dec-previous']);
  });
});
