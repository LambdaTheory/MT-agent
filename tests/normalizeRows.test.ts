import { describe, expect, it } from 'vitest';
import type { RawTableData } from '../src/domain/types.js';
import { normalizeRowsForPeriod } from '../src/extractor/normalizeRows.js';

function tableWith(headers: string[], rows: string[][]): RawTableData {
  return {
    period: '1d',
    headers,
    rows,
    collection: { period: '1d', actualPageSizes: [10], pageCount: 1, rowCount: rows.length, dedupedRowCount: rows.length, displayedTotalCount: rows.length, pageSizeFallback: false, complete: true },
  };
}

describe('normalizeRowsForPeriod 金额列', () => {
  const newHeaders = ['商品名称', '商品ID', 'SPU名称', 'SPUID', '频道访问次数', '创建订单数', '签约订单数', '审出订单数', '发货订单数', '创建订单金额', '签约订单金额', '审出订单金额', '发货订单金额'];

  it('解析新表头的 4 个金额列', () => {
    const table = tableWith(newHeaders, [['测试商品', 'P1', 'SPU', 'S1', '10', '5', '4', '3', '2', '500.5', '400', '300', '200']]);
    const [row] = normalizeRowsForPeriod(table);
    expect(row.createdOrderAmount).toBe(500.5);
    expect(row.signedOrderAmount).toBe(400);
    expect(row.reviewedOrderAmount).toBe(300);
    expect(row.shippedOrderAmount).toBe(200);
  });

  it('旧表头缺金额列时保留为 undefined，不报错', () => {
    const oldHeaders = ['商品名称', '商品ID', 'SPU名称', 'SPUID', '频道访问次数', '创建订单数', '签约订单数', '审出订单数', '发货订单数'];
    const table = tableWith(oldHeaders, [['测试商品', 'P1', 'SPU', 'S1', '10', '5', '4', '3', '2']]);
    const [row] = normalizeRowsForPeriod(table);
    expect(row.createdOrderAmount).toBeUndefined();
    expect(row.shippedOrderAmount).toBeUndefined();
  });

  it('金额列表头不与订单数列冲突', () => {
    const table = tableWith(newHeaders, [['测试商品', 'P1', 'SPU', 'S1', '10', '5', '4', '3', '2', '500', '400', '300', '200']]);
    const [row] = normalizeRowsForPeriod(table);
    expect(row.createdOrders).toBe(5);
    expect(row.shippedOrders).toBe(2);
  });
});
