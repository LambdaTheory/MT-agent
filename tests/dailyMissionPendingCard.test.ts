import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeApprovedDecision } from '../src/agentRuntime/dailyMissionExecution.js';
import type { DecisionRecord } from '../src/agentRuntime/decisionRecord.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

const decision: DecisionRecord = {
  decisionId: 'dec-1',
  runId: 'run-1',
  title: '预览改价',
  subjects: [{ kind: 'product', id: '648' }],
  operationType: 'price_down',
  recommendation: 'approve_to_execute',
  risk: 'high',
  rationale: [],
  evidenceRefs: ['x'],
  uncertainties: [],
  proposedTool: { toolName: 'rental.pricePreview', arguments: { productIds: ['648'], discount: 0.9 } },
};

function client(): RentalPriceSkillClient {
  return {
    preview: async () => ({ productId: '648', fields: { rent1day: '18.00' }, lines: ['1天:20->18'], warnings: [] }),
    execute: async () => ({ productId: '648', ok: true, lines: [] }),
    specDiscover: async () => ({ productId: '648', ok: true, dimensions: [] }),
    copy: async () => ({ ok: true, action: 'copy', productId: '648', lines: [] }),
    delist: async () => ({ ok: true, action: 'delist', productId: '648', lines: [] }),
    tenancySet: async () => ({ ok: true, action: 'tenancy-set', productId: '648', lines: [] }),
    specAddAndRefresh: async () => ({ ok: true, action: 'spec-add-and-refresh', productId: '648', lines: [] }),
  } as unknown as RentalPriceSkillClient;
}

describe('pending confirmation card', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-pend-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('marks pending_confirmation and not ok when a card is returned', async () => {
    const result = await executeApprovedDecision({ decision, outputDir: dir, options: { rentalPriceClient: client() } });

    expect(result.status).toBe('pending_confirmation');
    expect(result.ok).toBe(false);
    expect(result.card).toBeTruthy();
  });
});
