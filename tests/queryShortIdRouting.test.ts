import { describe, expect, it } from 'vitest';
import { parseBotIntent } from '../src/feishuBot/intent.js';

describe('short numeric product id routing', () => {
  it('routes short numeric status queries to product lookup, not ID mapping', () => {
    expect(parseBotIntent('查956')).toEqual({ type: 'query_product', keyword: '956' });
    expect(parseBotIntent('查询 956')).toEqual({ type: 'query_product', keyword: '956' });
    expect(parseBotIntent('商品 956')).toEqual({ type: 'query_product', keyword: '956' });
    expect(parseBotIntent('查ID 956')).toEqual({ type: 'lookup_product_id', query: '956' });
    expect(parseBotIntent('956 的平台ID')).toEqual({ type: 'lookup_product_id', query: '956' });
  });

  it('keeps dated short numeric queries on product status routing', () => {
    expect(parseBotIntent('2026-06-22 查956')).toEqual({ type: 'query_product', keyword: '956', date: '2026-06-22' });
    expect(parseBotIntent('2026-06-22 查询956')).toEqual({ type: 'query_product', keyword: '956', date: '2026-06-22' });
    expect(parseBotIntent('2026-06-22 查ID 956')).toEqual({ type: 'lookup_product_id', query: '956', date: '2026-06-22' });
  });
});
