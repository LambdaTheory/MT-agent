import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordOperationEvent } from '../src/agentRuntime/operationLedger.js';
import { buildDailyMissionAuditSummary } from '../src/cli/dailyMissionAudit.js';

describe('buildDailyMissionAuditSummary', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-audit-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('summarizes ledger events for a date', async () => {
    await recordOperationEvent(dir, {
      planId: 'p',
      at: '2026-07-01T09:00:00.000Z',
      event: 'decision_created',
      runId: 'run-1',
      decisionId: 'd1',
    });
    await recordOperationEvent(dir, {
      planId: 'p',
      at: '2026-07-01T09:05:00.000Z',
      event: 'approval_requested',
      runId: 'run-1',
      decisionId: 'd1',
    });

    const summary = await buildDailyMissionAuditSummary(dir, '2026-07-01');

    expect(summary.eventCounts.decision_created).toBe(1);
    expect(summary.eventCounts.approval_requested).toBe(1);
    expect(summary.events).toEqual(['decision_created', 'approval_requested']);
    expect(summary.approvals).toEqual(['d1']);
    expect(summary.executions).toEqual([]);
    expect(summary.lines.join('\n')).toContain('2026-07-01');
  });
});
