import { mkdtemp, rm } from 'node:fs/promises';
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
    await appendExecutionResult(dir, '2026-07-02', { decisionId: 'dec-1', ok: true, text: '已下架' });
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
});
