import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordOperationEvent } from '../src/agentRuntime/operationLedger.js';
import {
  collectDailyMissionContext,
  collectRecentOperations,
  createTrackRecordCollector,
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
    expect(ctx.collectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
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

  it('runs collectors in parallel and preserves sales context', async () => {
    const completed: string[] = [];
    const collectors: ContextCollector[] = [
      {
        name: 'slow',
        collect: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          completed.push('slow');
          return { exposure: { summary: 'slow' } };
        },
      },
      {
        name: 'fast',
        collect: async () => {
          completed.push('fast');
          return { sales: { summary: 'fast' } };
        },
      },
    ];

    const ctx = await collectDailyMissionContext(collectors, base);

    expect(completed).toEqual(['fast', 'slow']);
    expect(ctx.sales).toEqual({ summary: 'fast' });
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

describe('createTrackRecordCollector', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-track-context-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('injects built trackRecord into collected context patches', async () => {
    const missionDir = join(dir, 'daily-mission', '2026-07-01');
    await mkdir(missionDir, { recursive: true });
    await writeFile(join(missionDir, 'outcomes.json'), JSON.stringify([{
      decisionId: 'dec-1',
      runId: 'run-1',
      operationType: 'price_down',
      subject: { kind: 'product', id: '648' },
      executedAt: '2026-07-01T00:00:00.000Z',
      measuredAt: '2026-07-02T00:00:00.000Z',
      before: { exposure: 1 },
      after: { exposure: 2 },
      outcome: 'positive',
    }]), 'utf8');

    const patch = await createTrackRecordCollector(dir).collect({ runId: 'run-2', date: '2026-07-02', outputDir: dir });

    expect(patch.trackRecord).toEqual([{ key: 'price_down', operationType: 'price_down', samples: 1, positive: 1, neutral: 0, negative: 0, successRate: 1 }]);
  });
});
