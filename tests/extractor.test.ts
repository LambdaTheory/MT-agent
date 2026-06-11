import { describe, expect, it } from 'vitest';
import { normalizeText } from '../src/extractor/normalizeText.js';
import { extractStructuredNameAndId, getColumnDefinitionsForHeaders } from '../src/extractor/extractAntTable.js';
import { normalizeRowsForPeriod } from '../src/extractor/normalizeRows.js';

const collection = {
  period: '7d' as const,
  actualPageSizes: [100],
  pageCount: 1,
  rowCount: 1,
  dedupedRowCount: 1,
  displayedTotalCount: 1,
  pageSizeFallback: false,
  complete: true,
};

describe('extractor helpers', () => {
  it('normalizes whitespace', () => {
    expect(normalizeText('  商品\n 名称\t A  ')).toBe('商品 名称 A');
  });

  it('extracts product name and id from structured parts', () => {
    expect(extractStructuredNameAndId(['苹果手机租赁', '商品ID：10001', '复制'], 'product')).toEqual(['苹果手机租赁', '10001']);
  });

  it('extracts spu reference fields when present', () => {
    expect(extractStructuredNameAndId(['iPhone SPU', 'SPUID：SPU-9', '复制'], 'spu')).toEqual(['iPhone SPU', 'SPU-9']);
  });

  it('skips action columns and expands structured headers', () => {
    expect(getColumnDefinitionsForHeaders(['', '商品信息', 'SPU信息', '频道访问次数', '操作']).flatMap((item) => item.headers)).toEqual([
      '商品名称',
      '商品ID',
      'SPU名称',
      'SPUID',
      '频道访问次数',
    ]);
  });

  it('normalizes rows into product metrics', () => {
    expect(
      normalizeRowsForPeriod({
        period: '7d',
        headers: ['商品名称', '商品ID', 'SPU名称', 'SPUID', '频道访问次数', '创建订单数', '签约订单数', '审出订单数', '发货订单数'],
        rows: [['商品A', '10001', 'SPU A', 'SPU-1', '1,200', '30', '20', '10', '5']],
        collection,
      }),
    ).toEqual([
      {
        period: '7d',
        productName: '商品A',
        platformProductId: '10001',
        spuName: 'SPU A',
        spuId: 'SPU-1',
        visits: 1200,
        createdOrders: 30,
        signedOrders: 20,
        reviewedOrders: 10,
        shippedOrders: 5,
        createdOrderAmount: 0,
        signedOrderAmount: 0,
        reviewedOrderAmount: 0,
        shippedOrderAmount: 0,
      },
    ]);
  });

  it('throws when required headers are missing', () => {
    expect(() =>
      normalizeRowsForPeriod({
        period: '1d',
        headers: ['商品名称', '商品ID'],
        rows: [['商品A', '10001']],
        collection: { ...collection, period: '1d' },
      }),
    ).toThrow('Missing required headers for 1d');
  });
});
