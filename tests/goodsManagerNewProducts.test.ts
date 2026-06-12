import { describe, expect, it } from 'vitest';
import { fetchRecentGoodsManagerProductIds } from '../src/publicTraffic/goodsManagerNewProducts.js';

describe('fetchRecentGoodsManagerProductIds', () => {
  it('fetches paged goods-manager data and returns unique IDs submitted within the date window', async () => {
    const requestedUrls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      requestedUrls.push(url);
      const parsed = new URL(url);
      const page = parsed.searchParams.get('page');
      const body = page === '1'
        ? {
            data: [
              { ID: '701', 最近提交时间: '2026-06-12 09:00:00' },
              { ID: 'old', 最近提交时间: '2026-06-01 09:00:00' },
            ],
            total_pages: 2,
          }
        : {
            data: [
              { ID: '702', 最近提交时间: '2026-06-06 23:59:59' },
              { ID: '701', 最近提交时间: '2026-06-12 09:00:00' },
              { ID: 'bad-date', 最近提交时间: 'not a date' },
            ],
            total_pages: 2,
          };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    await expect(fetchRecentGoodsManagerProductIds({ baseUrl: 'http://goods.local:3010', days: 7, referenceDate: '2026-06-12', fetchImpl })).resolves.toEqual(['701', '702']);
    expect(requestedUrls).toEqual([
      'http://goods.local:3010/api/goods?page=1&limit=500&sort_by=%E6%9C%80%E8%BF%91%E6%8F%90%E4%BA%A4%E6%97%B6%E9%97%B4&sort_desc=true',
      'http://goods.local:3010/api/goods?page=2&limit=500&sort_by=%E6%9C%80%E8%BF%91%E6%8F%90%E4%BA%A4%E6%97%B6%E9%97%B4&sort_desc=true',
    ]);
  });
});
