import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectDailyMissionContext } from '../src/agentRuntime/dailyMissionContext.js';
import { createMarketPriceCollector } from '../src/agentRuntime/marketPriceCollector.js';

describe('createMarketPriceCollector', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-market-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loads dated market-price JSON into context without stripping fields', async () => {
    const missionDir = join(dir, 'daily-mission', '2026-07-02');
    await mkdir(missionDir, { recursive: true });
    await writeFile(join(missionDir, 'market-price.json'), JSON.stringify({ items: [{ productId: '648', price: 12, vendor: 'x' }] }), 'utf8');

    const context = await collectDailyMissionContext([createMarketPriceCollector(dir)], { runId: 'run-1', date: '2026-07-02', outputDir: dir });

    expect(context.marketPrice).toEqual({ items: [{ productId: '648', price: 12, vendor: 'x' }] });
    expect(context.missingSources).toEqual([]);
  });

  it('marks market price as missing when JSON is unavailable', async () => {
    const context = await collectDailyMissionContext([createMarketPriceCollector(dir)], { runId: 'run-1', date: '2026-07-02', outputDir: dir });

    expect(context.marketPrice).toBeUndefined();
    expect(context.missingSources).toEqual(['marketPrice']);
  });

  it('loads latest pricing from Price Monitor API and writes a dated snapshot', async () => {
    const requestedUrls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify({
        run_ts: '20260724_115150',
        captured_at: '2026-07-24 12:26:40',
        count: 1,
        pricing: [{
          product: 'X300',
          merchant: 'merchant-a',
          sku: '标准套餐',
          deposit: 1000,
          payable_total: 298,
          rent_total: 198,
          prices: { '1天': 38.7, '7天': 49.53, note: 'ignored' },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const context = await collectDailyMissionContext([
      createMarketPriceCollector({ outputDir: dir, apiBaseUrl: 'http://price-monitor.local/', productFilters: ['X300'], fetchImpl }),
    ], { runId: 'run-1', date: '2026-07-02', outputDir: dir });

    expect(requestedUrls).toEqual(['http://price-monitor.local/api/latest/pricing?product=X300']);
    expect(context.missingSources).toEqual([]);
    expect(context.marketPrice).toMatchObject({
      source: 'price-monitor-api',
      runTs: '20260724_115150',
      capturedAt: '2026-07-24 12:26:40',
      productFilters: ['X300'],
      count: 1,
      items: [{ product: 'X300', merchant: 'merchant-a', sku: '标准套餐', deposit: 1000, payableTotal: 298, rentTotal: 198, pricesByTerm: { '1天': 38.7, '7天': 49.53 } }],
    });
    const written = JSON.parse(await readFile(join(dir, 'daily-mission', '2026-07-02', 'market-price.json'), 'utf8')) as unknown;
    expect(written).toEqual(context.marketPrice);
  });

  it('falls back to local JSON when Price Monitor API fails', async () => {
    const missionDir = join(dir, 'daily-mission', '2026-07-02');
    await mkdir(missionDir, { recursive: true });
    await writeFile(join(missionDir, 'market-price.json'), JSON.stringify({ source: 'local-cache', items: [{ productId: '648', price: 12 }] }), 'utf8');
    const fetchImpl: typeof fetch = async () => new Response('unavailable', { status: 503 });

    const context = await collectDailyMissionContext([
      createMarketPriceCollector({ outputDir: dir, apiBaseUrl: 'http://price-monitor.local', fetchImpl }),
    ], { runId: 'run-1', date: '2026-07-02', outputDir: dir });

    expect(context.marketPrice).toEqual({ source: 'local-cache', items: [{ productId: '648', price: 12 }] });
    expect(context.missingSources).toEqual([]);
  });

  it('rejects invalid date path segments instead of reading outside daily-mission', async () => {
    const context = await collectDailyMissionContext([createMarketPriceCollector(dir)], { runId: 'run-1', date: '..\\outside', outputDir: dir });

    expect(context.marketPrice).toBeUndefined();
    expect(context.missingSources).toEqual(['marketPrice']);
  });

  it('does not replace fresh API data with local fallback when snapshot writing fails', async () => {
    await writeFile(join(dir, 'not-a-directory'), 'occupied', 'utf8');
    const fetchImpl: typeof fetch = async () => {
      return new Response(JSON.stringify({ run_ts: '20260724_115150', captured_at: null, count: 0, pricing: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const context = await collectDailyMissionContext([
      createMarketPriceCollector({
        outputDir: join(dir, 'not-a-directory'),
        apiBaseUrl: 'http://price-monitor.local',
        fetchImpl,
      }),
    ], { runId: 'run-1', date: '2026-07-02', outputDir: join(dir, 'not-a-directory') });

    expect(context.marketPrice).toBeUndefined();
    expect(context.missingSources).toEqual(['marketPrice']);
  });
});
