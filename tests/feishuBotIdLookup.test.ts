import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildProductIdIndex, formatIdLookupResult, lookupProductId } from '../src/feishuBot/idLookup.js';
import { parseBotIntent } from '../src/feishuBot/intent.js';
import { handleBotIntent } from '../src/feishuBot/tools.js';
import type { PublicTrafficDataReportContext } from '../src/publicTraffic/types.js';

const summary = {
  exposure: 1000,
  publicVisits: 50,
  dashboardVisits: 40,
  createdOrders: 3,
  shippedOrders: 1,
  amount: 88,
  exposureVisitRate: 0.05,
  visitCreatedOrderRate: 0.075,
  visitShipmentRate: 0.025,
};

const metric = {
  exposure: 10,
  publicVisits: 2,
  dashboardVisits: 2,
  createdOrders: 0,
  signedOrders: 0,
  reviewedOrders: 0,
  shippedOrders: 0,
  amount: 0,
  exposureVisitRate: 0.2,
  visitCreatedOrderRate: 0,
  visitShipmentRate: 0,
  hasExposureData: true,
  hasDashboardData: true,
};

const emptySectionNotes = {
  lowExposure: '',
  weakClick: '',
  weakConversion: '',
  highPotential: '',
  newProductObservation: '',
  lifecycleGovernance: '',
  recommendedActions: '',
};

function context(): PublicTrafficDataReportContext {
  return {
    date: '2026-06-11',
    summary: { '1d': summary, '7d': summary, '30d': summary },
    conclusions: [],
    rows: [
      { productName: 'iPhone 15', platformProductId: '2000000000000000000001', displayProductId: '端内ID 565', custodyDays: 10, periods: { '1d': metric, '7d': metric, '30d': metric } },
      { productName: '相机 A', platformProductId: '2000000000000000000700', displayProductId: '端内ID 700', custodyDays: 3, periods: { '1d': metric, '7d': metric, '30d': metric } },
      { productName: '相机 A 备用链接', platformProductId: '2000000000000000000701', displayProductId: '端内ID 700', custodyDays: 4, periods: { '1d': metric, '7d': metric, '30d': metric } },
      { productName: '未映射商品', platformProductId: '2000000000000000000900', displayProductId: '平台商品ID 2000000000000000000900', custodyDays: null, periods: { '1d': metric, '7d': metric, '30d': metric } },
    ],
    lowExposure: [],
    weakClick: [],
    weakConversion: [],
    highPotential: [],
    newProductObservation: [],
    lifecycleGovernance: [],
    recommendedActions: [],
    emptySectionNotes,
  };
}

async function writeContext(reportContext = context()): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mt-agent-bot-id-lookup-'));
  await mkdir(join(dir, '2026-06-11'), { recursive: true });
  await writeFile(join(dir, '2026-06-11', 'report-context.json'), JSON.stringify(reportContext));
  return dir;
}

describe('product id lookup', () => {
  it('looks up platform product IDs by internal product ID', () => {
    const result = lookupProductId(context(), '查ID 565');

    expect(result).toMatchObject({
      kind: 'internal',
      input: '565',
      internalId: '565',
      platformIds: ['2000000000000000000001'],
      productName: 'iPhone 15',
    });
    expect(formatIdLookupResult(result)).toBe('端内ID 565 对应平台商品ID：2000000000000000000001（iPhone 15）');
  });

  it('looks up internal product ID by platform product ID', () => {
    const result = lookupProductId(context(), '2000000000000000000001');

    expect(result).toMatchObject({
      kind: 'platform',
      input: '2000000000000000000001',
      internalId: '565',
      platformIds: ['2000000000000000000001'],
      productName: 'iPhone 15',
    });
    expect(formatIdLookupResult(result)).toBe('平台商品ID 2000000000000000000001 对应端内ID 565（iPhone 15）');
  });

  it('keeps every platform product ID for one internal product ID', () => {
    const index = buildProductIdIndex(context());

    expect(index.internalToPlatform.get('700')).toEqual(['2000000000000000000700', '2000000000000000000701']);
  });

  it('formats not-found results with guidance', () => {
    const result = lookupProductId(context(), '端内ID 999');

    expect(result.kind).toBe('not_found');
    expect(formatIdLookupResult(result)).toContain('没有找到 999 的ID映射');
    expect(formatIdLookupResult(result)).toContain('请确认已生成最新公域日报');
  });

  it('parses and handles bot lookup intents', async () => {
    expect(parseBotIntent('查ID 565')).toEqual({ type: 'lookup_product_id', query: '565' });

    const outputDir = await writeContext();
    const response = await handleBotIntent({ type: 'lookup_product_id', query: '565' }, outputDir);

    expect(response.text).toBe('端内ID 565 对应平台商品ID：2000000000000000000001（iPhone 15）');
  });
});
