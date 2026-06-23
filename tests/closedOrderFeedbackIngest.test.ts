import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildClosedOrderIngestDedupeKey,
  createEmptyClosedOrderIngestState,
  ingestClosedOrderFeedbackInputs,
  loadClosedOrderIngestState,
  saveClosedOrderIngestState,
} from '../src/closedOrderFeedback/ingest.js';

describe('closed order feedback ingest', () => {
  it('returns an empty default state for a missing state file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-agent-closed-order-ingest-'));
    const path = join(dir, 'closed-order-feedback-ingest.json');
    try {
      await expect(loadClosedOrderIngestState(path)).resolves.toEqual(createEmptyClosedOrderIngestState());
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writes a readable JSON state file on first ingest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-agent-closed-order-ingest-'));
    const path = join(dir, 'closed-order-feedback-ingest.json');
    try {
      const result = ingestClosedOrderFeedbackInputs(createEmptyClosedOrderIngestState(), [
        {
          closeId: 'close-1',
          closedAt: '2026-06-22T03:55:57.917Z',
          orderNo: 'SH202606220001',
          merchant: 'merchant-A',
          internalProductId: '560',
          rawRemark: 'cannot reach customer',
        },
      ], '2026-06-22T04:00:00.000Z');

      await saveClosedOrderIngestState(path, result.state);

      const loaded = await loadClosedOrderIngestState(path);
      const rawFile = await readFile(path, 'utf8');
      expect(result.addedCount).toBe(1);
      expect(result.updatedCount).toBe(0);
      expect(loaded.items).toHaveLength(1);
      expect(loaded.items[0]).toMatchObject({
        dedupeKey: 'close:close-1',
        closeId: 'close-1',
        internalProductId: '560',
        rawRemark: 'cannot reach customer',
        firstIngestedAt: '2026-06-22T04:00:00.000Z',
        lastIngestedAt: '2026-06-22T04:00:00.000Z',
        seenCount: 1,
      });
      expect(rawFile).toContain('\n  "version": 1,\n');
      expect(rawFile.endsWith('\n')).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('dedupes by closeId and merges newer non-empty fields', () => {
    const first = ingestClosedOrderFeedbackInputs(createEmptyClosedOrderIngestState(), [
      {
        closeId: 'close-1',
        internalProductId: '560',
        rawRemark: 'cannot reach customer',
      },
    ], '2026-06-22T04:00:00.000Z');

    const second = ingestClosedOrderFeedbackInputs(first.state, [
      {
        closeId: 'close-1',
        closedAt: '2026-06-22T03:55:57.917Z',
        orderNo: 'SH202606220001',
        merchant: 'merchant-A',
        internalProductId: '560',
        rawRemark: 'cannot reach customer',
      },
    ], '2026-06-22T05:00:00.000Z');

    expect(second.addedCount).toBe(0);
    expect(second.updatedCount).toBe(1);
    expect(second.state.items).toHaveLength(1);
    expect(second.state.items[0]).toMatchObject({
      dedupeKey: 'close:close-1',
      closedAt: '2026-06-22T03:55:57.917Z',
      orderNo: 'SH202606220001',
      merchant: 'merchant-A',
      firstIngestedAt: '2026-06-22T04:00:00.000Z',
      lastIngestedAt: '2026-06-22T05:00:00.000Z',
      seenCount: 2,
    });
  });

  it('falls back to deterministic remark-based dedupe when closeId is missing', () => {
    const firstKey = buildClosedOrderIngestDedupeKey({
      internalProductId: '560',
      closedAt: '2026-06-22T03:55:57.917Z',
      rawRemark: 'cannot   reach customer',
    });
    const secondKey = buildClosedOrderIngestDedupeKey({
      internalProductId: '560',
      closedAt: '2026-06-22T03:55:57.917Z',
      rawRemark: ' cannot reach customer ',
    });

    const result = ingestClosedOrderFeedbackInputs(createEmptyClosedOrderIngestState(), [
      {
        internalProductId: '560',
        closedAt: '2026-06-22T03:55:57.917Z',
        rawRemark: 'cannot   reach customer',
      },
      {
        internalProductId: '560',
        closedAt: '2026-06-22T03:55:57.917Z',
        rawRemark: ' cannot reach customer ',
      },
    ], '2026-06-22T04:00:00.000Z');

    expect(firstKey).toBe(secondKey);
    expect(firstKey.startsWith('remark:')).toBe(true);
    expect(result.state.items).toHaveLength(1);
    expect(result.updatedCount).toBe(1);
    expect(result.state.items[0].seenCount).toBe(2);
  });
});
