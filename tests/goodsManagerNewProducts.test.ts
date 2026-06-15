import { describe, expect, it } from 'vitest';
import { fetchRecentGoodsManagerProductIds, fetchRecentGoodsManagerProducts } from '../src/publicTraffic/goodsManagerNewProducts.js';

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

  it('returns enriched unique products submitted within the date window', async () => {
    const requestedUrls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      requestedUrls.push(url);
      const page = new URL(url).searchParams.get('page');
      const body = page === '1'
        ? {
            data: [
              {
                ID: 701,
                商品名称: '新品 Alpha',
                短标题: 'Alpha 短标题',
                最近提交时间: '2026-06-12 09:00:00',
                merchant: '主商家',
                商家: '备用商家',
                是否同步支付宝: '已同步',
                支付宝编码: 'ALI-701',
                库存: 8,
                skus: [{ id: 'sku-1' }, { id: 'sku-2' }],
              },
              {
                ID: 'old',
                商品名称: '旧商品',
                最近提交时间: '2026-06-01 09:00:00',
                库存: 99,
                skus: [{ id: 'old-sku' }],
              },
            ],
            total_pages: 2,
          }
        : {
            data: [
              {
                ID: '702',
                商品名称: '新品 Beta',
                短标题: null,
                最近提交时间: '2026-06-06 23:59:59',
                商家: '备用商家 B',
                是否同步支付宝: false,
                支付宝编码: null,
                库存: '12',
                skus: [{ id: 'sku-3' }],
              },
              {
                ID: '701',
                商品名称: '重复 Alpha',
                最近提交时间: '2026-06-12 10:00:00',
                skus: [{ id: 'duplicate' }],
              },
              { ID: 'bad-date', 商品名称: '坏日期', 最近提交时间: 'not a date' },
            ],
            total_pages: 2,
          };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    await expect(fetchRecentGoodsManagerProducts({ baseUrl: 'http://goods.local:3010/api/', days: 7, referenceDate: '2026-06-12', fetchImpl })).resolves.toEqual([
      {
        productId: '701',
        productName: '新品 Alpha',
        shortTitle: 'Alpha 短标题',
        submittedAt: '2026-06-12 09:00:00',
        merchant: '主商家',
        alipaySyncStatus: '已同步',
        alipayCode: 'ALI-701',
        stock: 8,
        skuCount: 2,
        maintenanceStatus: '待维护',
        note: '',
      },
      {
        productId: '702',
        productName: '新品 Beta',
        shortTitle: '',
        submittedAt: '2026-06-06 23:59:59',
        merchant: '备用商家 B',
        alipaySyncStatus: 'false',
        alipayCode: '',
        stock: 12,
        skuCount: 1,
        maintenanceStatus: '待维护',
        note: '',
      },
    ]);
    expect(requestedUrls[0]).toBe('http://goods.local:3010/api/goods?page=1&limit=500&sort_by=%E6%9C%80%E8%BF%91%E6%8F%90%E4%BA%A4%E6%97%B6%E9%97%B4&sort_desc=true');
  });

  it('returns newer submitted products before older product IDs', async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
      data: [
        { ID: '703', 商品名称: '较早链接', 最近提交时间: '2026-06-12 09:00:00' },
        { ID: '900', 商品名称: '最新链接', 最近提交时间: '2026-06-12 12:00:00' },
      ],
      total_pages: 1,
    }), { status: 200, headers: { 'content-type': 'application/json' } });

    await expect(fetchRecentGoodsManagerProductIds({ baseUrl: 'http://goods.local:3010', days: 7, referenceDate: '2026-06-12', fetchImpl })).resolves.toEqual(['900', '703']);
  });

  it('can require goods-manager products to be synced to Alipay', async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
      data: [
        { ID: '701', 商品名称: '已同步链接', 最近提交时间: '2026-06-12 09:00:00', 是否同步支付宝: '已同步' },
        { ID: '702', 商品名称: '未同步链接', 最近提交时间: '2026-06-12 09:00:00', 是否同步支付宝: '未同步' },
        { ID: '703', 商品名称: '布尔未同步', 最近提交时间: '2026-06-12 09:00:00', 是否同步支付宝: false },
      ],
      total_pages: 1,
    }), { status: 200, headers: { 'content-type': 'application/json' } });

    await expect(fetchRecentGoodsManagerProducts({ baseUrl: 'http://goods.local:3010', days: 7, referenceDate: '2026-06-12', fetchImpl, requireAlipaySynced: true })).resolves.toMatchObject([
      { productId: '701', alipaySyncStatus: '已同步' },
    ]);
  });
});
