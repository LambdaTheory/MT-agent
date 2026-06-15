import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PeriodKey, RawTableData } from '../src/domain/types.js';
import { buildPublicTrafficPaths } from '../src/publicTraffic/paths.js';
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

      const result = await rebuildPublicTrafficReport({ outputDir, date: runDate, refreshedAt: '12:00', send: false });
      const context = JSON.parse(await readFile(paths.reportContext, 'utf8'));

      expect(result.sent).toBe(false);
      expect(context.dataQualityNotes).toContain('访问页数据已于 12:00 补抓更新，本报告为重建版。');
      expect(context.dataQualityNotes.some((note: string) => note.includes('暂未更新'))).toBe(false);
      expect(context.newProductPoolItems[0].productId).toBe('101');
      expect(context.agentData.removedLinks[0].productId).toBe('900');
      await expect(readFile(paths.markdown, 'utf8')).resolves.toContain('公域数据日报');
      await expect(readFile(paths.workbook)).resolves.toBeInstanceOf(Buffer);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
