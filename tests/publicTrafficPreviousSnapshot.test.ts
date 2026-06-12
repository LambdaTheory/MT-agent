import { describe, expect, it } from 'vitest';
import { mergePreviousCumulativeSnapshots, normalizeDashboardRowsForReport, parsePreviousCumulativeSnapshot } from '../src/cli/publicTrafficReport.js';
import type { RawTableData } from '../src/domain/types.js';
import { createRunLog } from '../src/storage/runLog.js';

describe('parsePreviousCumulativeSnapshot', () => {
  it('rejects valid JSON that is not an exposure cumulative product array', () => {
    expect(() => parsePreviousCumulativeSnapshot('[{"foo":1}]')).toThrow(/Invalid previous exposure snapshot/);
  });

  it('accepts exposure cumulative products', () => {
    expect(
      parsePreviousCumulativeSnapshot(
        JSON.stringify([
          {
            productName: '商品A',
            platformProductId: '20260603220003308013234',
            exposure: 10,
            visits: 2,
            amount: 1.5,
            custodyDays: null,
            raw: { 商品信息: '商品A' },
          },
        ]),
      ),
    ).toHaveLength(1);
  });
});

describe('mergePreviousCumulativeSnapshots', () => {
  it('uses an older snapshot when the newest snapshot is missing a canonical product', () => {
    expect(
      mergePreviousCumulativeSnapshots(
        [
          [{ productName: 'Other', platformProductId: '2026060122000000000000', exposure: 10, visits: 1, amount: 0, custodyDays: 1, raw: {} }],
          [{ productName: 'SX70', platformProductId: '20260302220008988390751', exposure: 160078, visits: 7969, amount: 27308, custodyDays: 102, raw: {} }],
        ],
        { '2026030222000898839075': '251' },
      ),
    ).toEqual([
      { productName: 'Other', platformProductId: '2026060122000000000000', exposure: 10, visits: 1, amount: 0, custodyDays: 1, raw: {} },
      { productName: 'SX70', platformProductId: '2026030222000898839075', exposure: 160078, visits: 7969, amount: 27308, custodyDays: 102, raw: {} },
    ]);
  });
});

describe('normalizeDashboardRowsForReport', () => {
  const collection = (overrides: Partial<RawTableData['collection']> = {}): RawTableData['collection'] => ({
    period: '7d',
    actualPageSizes: [],
    pageCount: 0,
    rowCount: 0,
    dedupedRowCount: 0,
    displayedTotalCount: null,
    pageSizeFallback: false,
    complete: false,
    ...overrides,
  });

  it('returns valid period rows and logs failed empty period skips', () => {
    const rawTables: RawTableData[] = [
      {
        period: '1d',
        headers: ['商品名称', '商品ID', '频道访问次数', '创建订单数', '签约订单数', '审出订单数', '发货订单数'],
        rows: [['商品A', 'p-a', '3', '2', '1', '1', '1']],
        collection: {
          period: '1d',
          actualPageSizes: [100],
          pageCount: 1,
          rowCount: 1,
          dedupedRowCount: 1,
          displayedTotalCount: 1,
          pageSizeFallback: false,
          complete: true,
        },
      },
      {
        period: '7d',
        headers: [],
        rows: [],
        collection: {
          period: '7d',
          actualPageSizes: [],
          pageCount: 0,
          rowCount: 0,
          dedupedRowCount: 0,
          displayedTotalCount: null,
          pageSizeFallback: false,
          complete: false,
        },
      },
    ];
    const log = createRunLog('2026-06-10T12:00:00.000Z', 'https://example.test/dashboard');

    const rows = normalizeDashboardRowsForReport(rawTables, log);

    expect(rows).toEqual([
      {
        period: '1d',
        productName: '商品A',
        platformProductId: 'p-a',
        spuName: undefined,
        spuId: undefined,
        visits: 3,
        createdOrders: 2,
        signedOrders: 1,
        reviewedOrders: 1,
        shippedOrders: 1,
        createdOrderAmount: 0,
        signedOrderAmount: 0,
        reviewedOrderAmount: 0,
        shippedOrderAmount: 0,
      },
    ]);
    expect(log.toText()).toContain('后链路数据跳过 7d: Missing required headers for 7d');
  });

  it('throws when a non-empty period has missing required headers', () => {
    const rawTables: RawTableData[] = [
      {
        period: '30d',
        headers: ['商品名称', '商品ID'],
        rows: [['商品A', 'p-a']],
        collection: {
          period: '30d',
          actualPageSizes: [100],
          pageCount: 1,
          rowCount: 1,
          dedupedRowCount: 1,
          displayedTotalCount: 1,
          pageSizeFallback: false,
          complete: true,
        },
      },
    ];
    const log = createRunLog('2026-06-10T12:00:00.000Z', 'https://example.test/dashboard');

    expect(() => normalizeDashboardRowsForReport(rawTables, log)).toThrow(/Missing required headers/);
  });

  it('skips an empty failed table with no headers', () => {
    const rawTables: RawTableData[] = [
      {
        period: '7d',
        headers: [],
        rows: [],
        collection: collection({ period: '7d' }),
      },
    ];
    const log = createRunLog('2026-06-10T12:00:00.000Z', 'https://example.test/dashboard');

    expect(normalizeDashboardRowsForReport(rawTables, log)).toEqual([]);
    expect(log.toText()).toContain('后链路数据跳过 7d: Missing required headers for 7d');
  });

  it('throws for an empty malformed table with headers missing required fields', () => {
    const rawTables: RawTableData[] = [
      {
        period: '7d',
        headers: ['商品名称', '商品ID'],
        rows: [],
        collection: collection({ period: '7d' }),
      },
    ];
    const log = createRunLog('2026-06-10T12:00:00.000Z', 'https://example.test/dashboard');

    expect(() => normalizeDashboardRowsForReport(rawTables, log)).toThrow(/Missing required headers/);
  });

  it('throws for empty rows with non-zero collected row counts', () => {
    const rawTables: RawTableData[] = [
      {
        period: '7d',
        headers: [],
        rows: [],
        collection: collection({ period: '7d', rowCount: 1, dedupedRowCount: 1 }),
      },
    ];
    const log = createRunLog('2026-06-10T12:00:00.000Z', 'https://example.test/dashboard');

    expect(() => normalizeDashboardRowsForReport(rawTables, log)).toThrow(/Missing required headers/);
  });
});
