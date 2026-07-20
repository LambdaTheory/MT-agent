import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  evaluateOperationObservationOutcome,
  loadOperationObservations,
  recordGoodsTableNewLinkObservations,
  recordInactiveRefreshObservations,
} from '../src/operationObservations/store.js';

let outputDir = '';

async function freshOutputDir(): Promise<string> {
  outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-operation-observations-'));
  return outputDir;
}

describe('operation observations store', () => {
  afterEach(async () => {
    if (outputDir) await rm(outputDir, { recursive: true, force: true });
    outputDir = '';
  });

  it('dedupes a goods-table new link with the same inactive-refresh new link', async () => {
    const dir = await freshOutputDir();

    await recordGoodsTableNewLinkObservations(dir, {
      observedAt: '2026-07-17T00:00:00.000Z',
      items: [{ productId: '1001', platformProductId: 'p1001', productName: 'Pocket 3 new link', firstSeenDate: '2026-07-17' }],
    });
    await recordInactiveRefreshObservations(dir, {
      planRef: 'inactive_refresh_20260717_abcd',
      auditPath: 'output/latest/inactive-refresh-audits/inactive_refresh_20260717_abcd.json',
      newProductIds: ['1001'],
      delistedProductIds: ['901'],
      sourceProductIds: ['900'],
    });

    const store = await loadOperationObservations(dir);
    expect(store.observations).toHaveLength(1);
    expect(store.observations[0]).toMatchObject({
      operationType: 'inactive_refresh',
      subjects: [
        { role: 'new_link', productId: '1001', relatedProductId: '901', sourceProductId: '900' },
        { role: 'delisted_old_link', productId: '901', relatedProductId: '1001', sourceProductId: '900' },
      ],
    });
    expect(store.observations[0]?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolName: 'publicTraffic.goodsTableNewLink', firstSeenDate: '2026-07-17' }),
      expect.objectContaining({ toolName: 'operations.inactiveRefreshExecute', planRef: 'inactive_refresh_20260717_abcd' }),
    ]));
    expect(store.observations[0]?.observeUntil).toBe('2026-07-31T00:00:00.000Z');
  });

  it('evaluates observation outcomes from post-operation metrics', () => {
    expect(evaluateOperationObservationOutcome({ amount: 100, orders: 0, visits: 0, exposure: 0 })).toBe('positive');
    expect(evaluateOperationObservationOutcome({ amount: 0, orders: 1, visits: 0, exposure: 0 })).toBe('positive');
    expect(evaluateOperationObservationOutcome({ amount: 0, orders: 0, visits: 20, exposure: 100 })).toBe('neutral');
    expect(evaluateOperationObservationOutcome({ amount: 0, orders: 0, visits: 0, exposure: 0 })).toBe('negative');
    expect(evaluateOperationObservationOutcome({})).toBe('insufficient_data');
  });

  it('preserves concurrent observation upserts without losing either writer', async () => {
    const dir = await freshOutputDir();

    await Promise.all([
      recordGoodsTableNewLinkObservations(dir, {
        observedAt: '2026-07-17T00:00:00.000Z',
        items: [{ productId: '1001', platformProductId: 'p1001', productName: 'New A', firstSeenDate: '2026-07-17' }],
      }),
      recordGoodsTableNewLinkObservations(dir, {
        observedAt: '2026-07-17T00:00:00.000Z',
        items: [{ productId: '1002', platformProductId: 'p1002', productName: 'New B', firstSeenDate: '2026-07-17' }],
      }),
    ]);

    const store = await loadOperationObservations(dir);
    expect(store.observations.map((item) => item.subjects[0]?.productId).sort()).toEqual(['1001', '1002']);
  });
});
