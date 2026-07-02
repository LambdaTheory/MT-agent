import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeApprovedDecision, writeExecutionResults } from '../src/agentRuntime/dailyMissionExecution.js';
import { loadOperationLedgerJsonlEntries } from '../src/agentRuntime/operationLedger.js';
import type { DecisionRecord } from '../src/agentRuntime/decisionRecord.js';
import type { RentalPriceSkillClient } from '../src/feishuBot/rentalPrice.js';

function fakeClient(): RentalPriceSkillClient {
  return {
    preview: async () => ({ productId: '648', fields: {}, lines: [], warnings: [] }),
    execute: async () => ({ productId: '648', ok: true, lines: [] }),
    read: async () => ({ productId: '648', ok: true, specs: [], values: {}, lines: [] }),
    copy: async () => ({ productId: '648', ok: true, newProductId: '999', lines: [] }),
    delist: async () => ({ productId: '648', ok: true, lines: ['delisted'] }),
    tenancySet: async (_productId, days) => ({ productId: '648', ok: true, days, lines: [] }),
    specDiscover: async () => ({ productId: '648', ok: true, dimensions: [], lines: [] }),
    specAddAndRefresh: async (_productId, itemTitle) => ({ productId: '648', ok: true, itemTitle, lines: [] }),
  };
}

const decision: DecisionRecord = {
  decisionId: 'dec-1',
  runId: 'run-1',
  title: '下架 648',
  subjects: [{ kind: 'product', id: '648' }],
  operationType: 'delist',
  recommendation: 'approve_to_execute',
  risk: 'high',
  rationale: ['长期无曝光'],
  evidenceRefs: ['exposure'],
  uncertainties: [],
  proposedTool: { toolName: 'rental.delist', arguments: { productId: '648' } },
};

describe('executeApprovedDecision', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-dmx-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('records approval_accepted and execution events with attribution', async () => {
    const result = await executeApprovedDecision({ decision, outputDir: dir, options: { rentalPriceClient: fakeClient() } });

    expect(result.ok).toBe(true);
    const date = new Date().toISOString().slice(0, 10);
    const entries = (await loadOperationLedgerJsonlEntries(dir, date)).filter((entry) => entry.decisionId === 'dec-1');
    expect(entries.map((entry) => entry.event)).toEqual(['approval_accepted', 'execution_started', 'execution_succeeded']);
    expect(entries.every((entry) => entry.runId === 'run-1')).toBe(true);
    expect(entries.every((entry) => entry.subject?.id === '648')).toBe(true);
  });

  it('records dated execution events under the mission date partition', async () => {
    await executeApprovedDecision({ decision, outputDir: dir, date: '2026-07-02', options: { rentalPriceClient: fakeClient() } });

    const entries = (await loadOperationLedgerJsonlEntries(dir, '2026-07-02')).filter((entry) => entry.decisionId === 'dec-1');
    expect(entries.map((entry) => entry.event)).toEqual(['approval_accepted', 'execution_started', 'execution_succeeded']);
    expect(entries.every((entry) => entry.metadata?.missionDate === '2026-07-02')).toBe(true);
  });

  it('writes execution-results.json', async () => {
    await writeExecutionResults(dir, '2026-07-02', [{ runId: 'run-1', decisionId: 'dec-1', ok: true, status: 'executed', text: 'delisted' }]);

    const raw = await readFile(join(dir, 'daily-mission', '2026-07-02', 'execution-results.json'), 'utf8');
    expect(JSON.parse(raw)[0].decisionId).toBe('dec-1');
  });

  it('keeps operationConfirmRequest ok=false as a failed execution result', async () => {
    const result = await executeApprovedDecision({
      decision: {
        ...decision,
        proposedTool: { toolName: 'rental.operationConfirmRequest', arguments: { action: 'delist', productId: '648' } },
      },
      outputDir: dir,
      options: { rentalPriceClient: { ...fakeClient(), delist: async () => ({ productId: '648', ok: false, lines: ['failed'] }) } },
    });

    expect(result.ok).toBe(false);
    const date = new Date().toISOString().slice(0, 10);
    const events = (await loadOperationLedgerJsonlEntries(dir, date)).filter((entry) => entry.decisionId === 'dec-1');
    expect(events.map((entry) => entry.event)).toEqual(['approval_accepted', 'execution_started', 'execution_failed']);
  });
});
