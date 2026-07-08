import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOperationLedgerJsonlEntries } from '../src/agentRuntime/operationLedger.js';
import { attributeOutcomes } from '../src/agentRuntime/outcomeAttribution.js';

describe('attributeOutcomes', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-outcome-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes positive outcome records and attribution ledger events', async () => {
    const missionDir = join(dir, 'daily-mission', '2026-07-02');
    await mkdir(missionDir, { recursive: true });
    await writeFile(join(missionDir, 'execution-results.json'), JSON.stringify([{
      runId: 'run-1',
      decisionId: 'dec-1',
      ok: true,
      status: 'executed',
      text: 'done',
      operationType: 'price_down',
      subject: { kind: 'product', id: '648' },
      executedAt: '2026-07-02T00:00:00.000Z',
      beforeMetric: { exposure: 10, sales: 1 },
      afterMetric: { exposure: 20, sales: 2 },
    }]), 'utf8');

    const records = await attributeOutcomes(dir, '2026-07-02', 7);

    expect(records[0]).toMatchObject({ decisionId: 'dec-1', outcome: 'positive' });
    const raw = await readFile(join(missionDir, 'outcomes.json'), 'utf8');
    expect(JSON.parse(raw)[0].outcome).toBe('positive');
    const events = await loadOperationLedgerJsonlEntries(dir, '2026-07-02');
    expect(events.map((entry) => entry.event)).toContain('outcome_attributed');
  });

  it('marks outcome pending when after metric is missing', async () => {
    const missionDir = join(dir, 'daily-mission', '2026-07-02');
    await mkdir(missionDir, { recursive: true });
    await writeFile(join(missionDir, 'execution-results.json'), JSON.stringify([{
      runId: 'run-1', decisionId: 'dec-1', ok: true, status: 'executed', text: 'done', beforeMetric: { exposure: 10 },
    }]), 'utf8');

    const records = await attributeOutcomes(dir, '2026-07-02', 7);

    expect(records[0]?.outcome).toBe('pending');
    const events = await loadOperationLedgerJsonlEntries(dir, '2026-07-02');
    expect(events.map((entry) => entry.event)).not.toContain('outcome_attributed');
  });

  it('uses lookahead report context as after metric when execution result has only a before snapshot', async () => {
    const missionDir = join(dir, 'daily-mission', '2026-07-02');
    const afterDir = join(dir, '2026-07-09');
    await mkdir(missionDir, { recursive: true });
    await mkdir(afterDir, { recursive: true });
    await writeFile(join(missionDir, 'execution-results.json'), JSON.stringify([{
      runId: 'run-1',
      decisionId: 'dec-1',
      ok: true,
      status: 'executed',
      text: 'done',
      operationType: 'price_down',
      subject: { kind: 'product', id: '648' },
      beforeMetric: { exposure: 10, sales: 1 },
    }]), 'utf8');
    await writeFile(join(afterDir, 'report-context.json'), JSON.stringify({
      rows: [{ productId: '648', exposure: 20, signedOrders: 2 }],
    }), 'utf8');

    const records = await attributeOutcomes(dir, '2026-07-02', 7);

    expect(records[0]).toMatchObject({ decisionId: 'dec-1', after: { exposure: 20, sales: 2 }, outcome: 'positive' });
  });
});
