import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { recordOperationEvent } from '../src/agentRuntime/operationLedger.js';
import { loadClosedOrderRegistryContext } from '../src/closedOrderFeedback/runtime.js';
import type { PeriodKey, RawTableData } from '../src/domain/types.js';
import { buildPublicTrafficPaths } from '../src/publicTraffic/paths.js';
vi.mock('../src/closedOrderFeedback/runtime.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/closedOrderFeedback/runtime.js')>();
  return { ...actual, loadClosedOrderRegistryContext: vi.fn(actual.loadClosedOrderRegistryContext) };
});

import { rebuildPublicTrafficReport } from '../src/publicTraffic/rebuildPublicTrafficReport.js';

function raw(period: PeriodKey): RawTableData {
  return {
    period,
    headers: ['商品名称', '商品ID', '访问次数', '创建订单数', '签约订单数', '审出订单数', '发货订单数', '发货订单金额'],
    rows: [['测试商品', 'p1', period === '1d' ? '80' : '200', '4', '3', '2', period === '1d' ? '1' : '5', '199']],
    collection: {
      period,
      actualPageSizes: [50],
      pageCount: 1,
      rowCount: 1,
      dedupedRowCount: 1,
      displayedTotalCount: 1,
      pageSizeFallback: false,
      complete: true,
    },
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

describe('rebuildPublicTrafficReport', () => {
  it('rebuilds report outputs from existing artifacts and keeps first-report context extras', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-rebuild-'));
    const runDate = '2026-06-15';
    const paths = buildPublicTrafficPaths(outputDir, runDate);
    try {
      const priorContext = {
        date: '2026-06-14',
        generationId: 'prior-generation-id',
        summary: {},
        conclusions: [],
        dataQualityNotes: ['今日访问数据支付宝暂未更新，本期访问量板块指标缺失。'],
        rows: [],
        lowExposure: [],
        weakClick: [],
        weakConversion: [],
        highPotential: [],
        newProductObservation: [],
        lifecycleGovernance: [],
        recommendedActions: [],
        emptySectionNotes: {
          lowExposure: '',
          weakClick: '',
          weakConversion: '',
          highPotential: '',
          newProductObservation: '',
          lifecycleGovernance: '',
          recommendedActions: '',
        },
        newProductPoolItems: [{ productId: '101', productName: '新品', shortTitle: '', recentlySubmittedAt: '2026-06-15', merchant: '', syncStatus: '', alipayCode: '', stock: '', skuCount: 0 }],
        newProductPoolIds: ['101'],
        agentData: { removedLinks: [{ productId: '900', platformProductId: 'p900', productName: '下架商品', removedDate: '2026-06-15', reason: '商品总表缺失', source: 'goods_snapshot_diff' }] },
      };

      await writeJson(paths.reportContext, priorContext);
      await writeJson(paths.exposureCumulativeProducts, [{ productName: '测试商品', platformProductId: 'p1', exposure: 100, visits: 10, amount: 199, custodyDays: 3, raw: {} }]);
      await writeJson(paths.exposureOverview, [{ period: '1d', exposure: 100, visits: 10, conversionRate: 10, amount: 199 }]);
      await writeJson(paths.exposureDailyDelta, [{ date: '2026-06-14', productName: '测试商品', platformProductId: 'p1', exposure: 100, visits: 10, amount: 199, custodyDays: 3, flags: [] }]);
      await writeJson(paths.exposure7dSummary, [{ productName: '测试商品', platformProductId: 'p1', exposure: 500, visits: 60, amount: 500, visitRate: 0.12, days: 7, flags: [] }]);
      await writeJson(paths.exposure30dSummary, [{ productName: '测试商品', platformProductId: 'p1', exposure: 1000, visits: 120, amount: 900, visitRate: 0.12, days: 30, flags: [] }]);
      await writeJson(paths.publicVisitRaw['1d'], raw('1d'));
      await writeJson(paths.publicVisitRaw['7d'], raw('7d'));
      await writeJson(paths.publicVisitRaw['30d'], raw('30d'));
      await writeJson(paths.orderAnalysis, {
        runDate,
        capturedAt: '2026-06-15T01:00:00.000Z',
        pages: {
          overview: { key: 'overview', label: '标准订单分析', dataDate: '2026-06-14', indicators: [] },
          delivery: { key: 'delivery', label: '发货分析', dataDate: '2026-06-14', indicators: [] },
          return: { key: 'return', label: '归还分析', dataDate: '2026-06-14', indicators: [] },
          customs: { key: 'customs', label: '关单分析', dataDate: '2026-06-14', indicators: [] },
        },
      });
      const overridesPath = join(outputDir, 'link-registry-overrides.json');
      await writeJson(overridesPath, { version: 1 });

      const result = await rebuildPublicTrafficReport({ outputDir, date: runDate, refreshedAt: '12:00', send: false, closedOrderRegistryPaths: { overridesPath } });
      const context = JSON.parse(await readFile(paths.reportContext, 'utf8'));
      const sameSkuSnapshot = JSON.parse(await readFile(paths.sameSkuSnapshot, 'utf8'));

      expect(result.sent).toBe(false);
      expect(result.inventorySnapshotWarning).toBeUndefined();
      expect(typeof result.context.generationId).toBe('string');
      expect(result.context.generationId).not.toBe('');
      expect(result.context.generationId).not.toBe(priorContext.generationId);
      expect(context.generationId).toBe(result.context.generationId);
      expect(context.dataQualityNotes).toContain('访问页数据已于 12:00 补抓更新，本报告为重建版。');
      expect(context.dataQualityNotes.some((note: string) => note.includes('暂未更新'))).toBe(false);
      expect(context.newProductPoolItems[0].productId).toBe('101');
      expect(context.agentData.removedLinks[0].productId).toBe('900');
      expect(sameSkuSnapshot.schemaVersion).toBe(1);
      expect(sameSkuSnapshot.generationId).toBe(context.generationId);
      expect(sameSkuSnapshot.date).toBe(runDate);
      expect(Array.isArray(sameSkuSnapshot.groups)).toBe(true);
      await expect(readFile(paths.markdown, 'utf8')).resolves.toContain('公域数据日报');
      await expect(readFile(paths.workbook)).resolves.toBeInstanceOf(Buffer);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('uses the rebuild date when honoring refresh suppression for inventory snapshot registry attribution', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-rebuild-suppression-date-'));
    const runDate = '2026-07-14';
    const paths = buildPublicTrafficPaths(outputDir, runDate);
    try {
      await writeJson(paths.reportContext, {
        date: runDate,
        summary: {},
        conclusions: [],
        dataQualityNotes: [],
        rows: [{
          productName: 'Agent下架商品',
          platformProductId: 'p1702',
          displayProductId: '端内ID 1702',
          custodyDays: 1,
          periods: {
            '1d': { exposure: 10, publicVisits: 1, dashboardVisits: 1, createdOrders: 0, shippedOrders: 0, amount: 0, exposureVisitRate: 0.1, visitCreatedOrderRate: 0, visitShipmentRate: 0, hasExposureData: true, hasDashboardData: true },
            '7d': { exposure: 10, publicVisits: 1, dashboardVisits: 1, createdOrders: 0, shippedOrders: 0, amount: 0, exposureVisitRate: 0.1, visitCreatedOrderRate: 0, visitShipmentRate: 0, hasExposureData: true, hasDashboardData: true },
            '30d': { exposure: 10, publicVisits: 1, dashboardVisits: 1, createdOrders: 0, shippedOrders: 0, amount: 0, exposureVisitRate: 0.1, visitCreatedOrderRate: 0, visitShipmentRate: 0, hasExposureData: true, hasDashboardData: true },
          },
        }],
        lowExposure: [],
        weakClick: [],
        weakConversion: [],
        highPotential: [],
        newProductObservation: [],
        lifecycleGovernance: [],
        recommendedActions: [],
        emptySectionNotes: { lowExposure: '', weakClick: '', weakConversion: '', highPotential: '', newProductObservation: '', lifecycleGovernance: '', recommendedActions: '' },
        agentData: { removedLinks: [] },
      });
      await writeJson(paths.exposureCumulativeProducts, [{ productName: 'Agent下架商品', platformProductId: 'p1702', exposure: 100, visits: 10, amount: 0, custodyDays: 3, raw: {} }]);
      await writeJson(paths.exposureOverview, [{ period: '1d', exposure: 100, visits: 10, conversionRate: 10, amount: 0 }]);
      await writeJson(paths.exposureDailyDelta, [{ date: runDate, productName: 'Agent下架商品', platformProductId: 'p1702', exposure: 100, visits: 10, amount: 0, custodyDays: 3, flags: [] }]);
      await writeJson(paths.exposure7dSummary, [{ productName: 'Agent下架商品', platformProductId: 'p1702', exposure: 500, visits: 60, amount: 0, visitRate: 0.12, days: 7, flags: [] }]);
      await writeJson(paths.exposure30dSummary, [{ productName: 'Agent下架商品', platformProductId: 'p1702', exposure: 1000, visits: 120, amount: 0, visitRate: 0.12, days: 30, flags: [] }]);
      await writeJson(paths.publicVisitRaw['1d'], raw('1d'));
      await writeJson(paths.publicVisitRaw['7d'], raw('7d'));
      await writeJson(paths.publicVisitRaw['30d'], raw('30d'));
      await writeJson(paths.orderAnalysis, {
        runDate,
        capturedAt: '2026-07-14T01:00:00.000Z',
        pages: {
          overview: { key: 'overview', label: '标准订单分析', dataDate: runDate, indicators: [] },
          delivery: { key: 'delivery', label: '发货分析', dataDate: runDate, indicators: [] },
          return: { key: 'return', label: '归还分析', dataDate: runDate, indicators: [] },
          customs: { key: 'customs', label: '关单分析', dataDate: runDate, indicators: [] },
        },
      });

      const productIdMapPath = join(outputDir, 'product-id-map.json');
      const productNameMapPath = join(outputDir, 'product-name-map.json');
      const firstSeenPath = join(outputDir, 'goods-first-seen.json');
      const goodsSnapshotPath = join(outputDir, 'goods-current-snapshot.json');
      const lifecyclePath = join(outputDir, 'goods-link-lifecycle.json');
      const daemonCatalogPath = join(outputDir, 'link-registry-daemon-catalog.json');
      const overridesPath = join(outputDir, 'link-registry-overrides.json');
      await writeJson(productIdMapPath, { p1702: '1702' });
      await writeJson(productNameMapPath, { '1702': 'DJI Pocket 3 Agent下架商品' });
      await writeJson(firstSeenPath, { '1702': { firstSeenDate: '2026-07-01', platformProductId: 'p1702', productName: 'DJI Pocket 3 Agent下架商品' } });
      await writeJson(goodsSnapshotPath, []);
      await writeJson(lifecyclePath, null);
      await writeJson(daemonCatalogPath, { generatedAt: '2026-07-14T10:00:00.000Z', count: 1, excludedCount: 0, entries: [{ internalProductId: '1702', productName: 'DJI Pocket 3 Agent下架商品', syncStatus: '已下架', discoveredAt: '2026-07-14T10:00:00.000Z' }] });
      await writeJson(overridesPath, { version: 1, entries: [{ internalProductId: '1702', shortName: '保留覆盖名' }] });
      await writeJson(join(outputDir, 'state', 'link-registry-refresh-suppression.json'), { version: 1, referenceDate: runDate, suppressDelistAttribution: true });
      await recordOperationEvent(outputDir, {
        planId: 'plan-1',
        at: '2026-07-14T09:00:00.000Z',
        event: 'execution_succeeded',
        toolName: 'rental.delist',
        subject: { kind: 'product', id: '1702' },
        metadata: { rentalAction: 'delist', executionTimestampRecorded: true },
      });

      const registryLoader = vi.mocked(loadClosedOrderRegistryContext);
      registryLoader.mockClear();
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-16T09:00:00.000Z'));
      try {
        await rebuildPublicTrafficReport({
          outputDir,
          date: runDate,
          send: false,
          productIdMappingPath: productIdMapPath,
          closedOrderRegistryPaths: { productIdMapPath, productNameMapPath, firstSeenPath, goodsSnapshotPath, lifecyclePath, daemonCatalogPath, overridesPath, referenceDate: '2026-07-15' },
        });

        expect(registryLoader).toHaveBeenLastCalledWith(expect.objectContaining({ referenceDate: runDate }), expect.anything());
        const registryContext = await registryLoader.mock.results.at(-1)?.value as Awaited<ReturnType<typeof loadClosedOrderRegistryContext>>;
        const entry = registryContext.registry.find((item) => item.internalProductId === '1702');
        expect(entry).toMatchObject({ shortName: '保留覆盖名' });
        expect(entry).not.toHaveProperty('delistCause');
        const sameSkuSnapshot = JSON.parse(await readFile(paths.sameSkuSnapshot, 'utf8'));
        expect(sameSkuSnapshot.registryAuditSummary).toMatchObject({
          onSaleLinks: 0,
          delistedLinks: 1,
          goneLinks: 0,
          unknownLinks: 0,
        });
      } finally {
        vi.useRealTimers();
      }
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('keeps rebuilt report outputs when link registry overrides cannot build inventory snapshot', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-rebuild-bad-registry-'));
    const runDate = '2026-06-15';
    const paths = buildPublicTrafficPaths(outputDir, runDate);
    try {
      await writeJson(paths.reportContext, {
        date: '2026-06-14',
        summary: {},
        conclusions: [],
        dataQualityNotes: [],
        rows: [],
        lowExposure: [],
        weakClick: [],
        weakConversion: [],
        highPotential: [],
        newProductObservation: [],
        lifecycleGovernance: [],
        recommendedActions: [],
        emptySectionNotes: { lowExposure: '', weakClick: '', weakConversion: '', highPotential: '', newProductObservation: '', lifecycleGovernance: '', recommendedActions: '' },
        agentData: { removedLinks: [] },
      });
      await writeJson(paths.exposureCumulativeProducts, [{ productName: '测试商品', platformProductId: 'p1', exposure: 100, visits: 10, amount: 199, custodyDays: 3, raw: {} }]);
      await writeJson(paths.exposureOverview, [{ period: '1d', exposure: 100, visits: 10, conversionRate: 10, amount: 199 }]);
      await writeJson(paths.exposureDailyDelta, [{ date: '2026-06-14', productName: '测试商品', platformProductId: 'p1', exposure: 100, visits: 10, amount: 199, custodyDays: 3, flags: [] }]);
      await writeJson(paths.exposure7dSummary, [{ productName: '测试商品', platformProductId: 'p1', exposure: 500, visits: 60, amount: 500, visitRate: 0.12, days: 7, flags: [] }]);
      await writeJson(paths.exposure30dSummary, [{ productName: '测试商品', platformProductId: 'p1', exposure: 1000, visits: 120, amount: 900, visitRate: 0.12, days: 30, flags: [] }]);
      await writeJson(paths.publicVisitRaw['1d'], raw('1d'));
      await writeJson(paths.publicVisitRaw['7d'], raw('7d'));
      await writeJson(paths.publicVisitRaw['30d'], raw('30d'));
      await writeJson(paths.orderAnalysis, {
        runDate,
        capturedAt: '2026-06-15T01:00:00.000Z',
        pages: {
          overview: { key: 'overview', label: '标准订单分析', dataDate: '2026-06-14', indicators: [] },
          delivery: { key: 'delivery', label: '发货分析', dataDate: '2026-06-14', indicators: [] },
          return: { key: 'return', label: '归还分析', dataDate: '2026-06-14', indicators: [] },
          customs: { key: 'customs', label: '关单分析', dataDate: '2026-06-14', indicators: [] },
        },
      });
      const overridesPath = join(outputDir, 'bad-link-registry-overrides.json');
      await writeJson(overridesPath, { version: 1, entries: [{ internalProductId: '701', sameSkuGroupId: 'bad/group' }] });

      const result = await rebuildPublicTrafficReport({ outputDir, date: runDate, refreshedAt: '12:00', send: false, closedOrderRegistryPaths: { overridesPath } });

      expect(result.sent).toBe(false);
      expect(result.inventorySnapshotWarning).toContain('Invalid sameSkuGroupId: bad/group');
      const context = JSON.parse(await readFile(paths.reportContext, 'utf8'));
      expect(typeof context.generationId).toBe('string');
      expect(context.generationId).not.toBe('');
      expect(context.dataQualityNotes).toContain('访问页数据已于 12:00 补抓更新，本报告为重建版。');
      await expect(readFile(paths.markdown, 'utf8')).resolves.toContain('公域数据日报');
      await expect(readFile(paths.workbook)).resolves.toBeInstanceOf(Buffer);
      await expect(readFile(paths.sameSkuSnapshot, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
