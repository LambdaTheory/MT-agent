import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendExecutionResult, executeApprovedDecision } from '../src/agentRuntime/dailyMissionExecution.js';
import type { DecisionRecord } from '../src/agentRuntime/decisionRecord.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

const decision: DecisionRecord = {
  decisionId: 'dec-1',
  runId: 'run-1',
  title: '下架 648',
  subjects: [{ kind: 'product', id: '648' }],
  operationType: 'delist',
  recommendation: 'approve_to_execute',
  risk: 'high',
  rationale: [],
  evidenceRefs: ['x'],
  uncertainties: [],
  proposedTool: { toolName: 'rental.delist', arguments: { productId: '648' } },
};

function fakeClient(delist: ReturnType<typeof vi.fn>): RentalPriceSkillClient {
  return {
    preview: async () => ({ productId: '648', fields: {}, lines: [], warnings: [] }),
    execute: async () => ({ productId: '648', ok: true, lines: [] }),
    specDiscover: async () => ({ productId: '648', ok: true, dimensions: [] }),
    copy: async () => ({ ok: true, action: 'copy', productId: '648', lines: [] }),
    delist,
    tenancySet: async () => ({ ok: true, action: 'tenancy-set', productId: '648', lines: [] }),
    specAddAndRefresh: async () => ({ ok: true, action: 'spec-add-and-refresh', productId: '648', lines: [] }),
  } as unknown as RentalPriceSkillClient;
}

describe('daily mission idempotency', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-idem-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('does not call client again when decision already executed ok', async () => {
    await appendExecutionResult(dir, '2026-07-02', { runId: 'run-1', decisionId: 'dec-1', ok: true, status: 'executed', text: '已下架' });
    const delist = vi.fn(async () => ({ ok: true, action: 'delist', productId: '648', lines: [] }));

    const result = await executeApprovedDecision({
      decision,
      outputDir: dir,
      date: '2026-07-02',
      options: { rentalPriceClient: fakeClient(delist) },
    });

    expect(result.ok).toBe(true);
    expect(delist).not.toHaveBeenCalled();
  });

  it('does not treat the same decisionId in another run as already executed', async () => {
    await appendExecutionResult(dir, '2026-07-02', { runId: 'other-run', decisionId: 'dec-1', ok: true, status: 'executed', text: '已下架' });
    const delist = vi.fn(async () => ({ ok: true, action: 'delist', productId: '648', lines: [] }));

    const result = await executeApprovedDecision({
      decision,
      outputDir: dir,
      date: '2026-07-02',
      options: { rentalPriceClient: fakeClient(delist) },
    });

    expect(result.ok).toBe(true);
    expect(delist).toHaveBeenCalledTimes(1);
  });

  it('writes a processing claim before executing a dated decision', async () => {
    let claimed = false;
    const delist = vi.fn(async () => {
      const raw = await readFile(join(dir, 'daily-mission', '2026-07-02', 'execution-results.json'), 'utf8');
      claimed = JSON.parse(raw).some((entry: { runId?: string; decisionId?: string; status?: string }) => entry.runId === 'run-1' && entry.decisionId === 'dec-1' && entry.status === 'processing');
      return { ok: true, action: 'delist', productId: '648', lines: [] };
    });

    await executeApprovedDecision({
      decision,
      outputDir: dir,
      date: '2026-07-02',
      options: { rentalPriceClient: fakeClient(delist) },
    });

    expect(claimed).toBe(true);
  });

  it('does not execute again when decision is already pending confirmation', async () => {
    await appendExecutionResult(dir, '2026-07-02', { runId: 'run-1', decisionId: 'dec-1', ok: false, status: 'pending_confirmation', text: '等待二次确认' });
    const delist = vi.fn(async () => ({ ok: true, action: 'delist', productId: '648', lines: [] }));

    const result = await executeApprovedDecision({
      decision,
      outputDir: dir,
      date: '2026-07-02',
      options: { rentalPriceClient: fakeClient(delist) },
    });

    expect(result.status).toBe('pending_confirmation');
    expect(delist).not.toHaveBeenCalled();
  });
});
