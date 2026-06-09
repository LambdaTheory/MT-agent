import { describe, expect, it } from 'vitest';
import type { DailyReportData } from '../src/domain/types.js';
import { buildMarkdownReport } from '../src/report/buildMarkdown.js';
import { buildWorkbook } from '../src/report/buildWorkbook.js';

const report: DailyReportData = {
  date: '2026-06-08',
  incomplete: false,
  rawTables: [
    {
      period: '1d',
      headers: ['商品名称', '商品ID', '频道访问次数'],
      rows: [['商品A', '10001', '10']],
      collection: {
        period: '1d',
        actualPageSizes: [10],
        pageCount: 1,
        rowCount: 1,
        dedupedRowCount: 1,
        displayedTotalCount: 1,
        pageSizeFallback: true,
        complete: true,
      },
    },
  ],
  analysisRows: [
    {
      productName: '商品A',
      platformProductId: '10001',
      internalProductId: 'jh-9001',
      mappingStatus: 'mapped',
      metrics: {
        '1d': {
          productName: '商品A',
          platformProductId: '10001',
          visits: 10,
          createdOrders: 0,
          signedOrders: 0,
          reviewedOrders: 0,
          shippedOrders: 0,
        },
        '7d': null,
        '30d': {
          productName: '商品A',
          platformProductId: '10001',
          visits: 300,
          createdOrders: 0,
          signedOrders: 0,
          reviewedOrders: 0,
          shippedOrders: 0,
        },
      },
      riskScore: 85,
      opportunityScore: 5,
      riskLevel: '高',
      opportunityLevel: '低',
      action: '疑似失活',
      confidence: '高',
      reason: '30天访问300，发货0',
    },
  ],
};

describe('report builders', () => {
  it('builds markdown summary', () => {
    const markdown = buildMarkdownReport(report);
    expect(markdown).toContain('# MT每日运营日报 2026-06-08');
    expect(markdown).toContain('疑似失活：1');
    expect(markdown).toContain('商品ID未映射：0');
    expect(markdown).toContain('## 优先处理：价格/转化问题');
    expect(markdown).toContain('## 增长机会：补链/加曝光');
    expect(markdown).toContain('## 下架观察：疑似失活');
    expect(markdown).toContain('1. 端内ID jh-9001：建议动作=疑似失活。原因：30天访问300，发货0');
  });

  it('creates raw and analysis sheets', () => {
    const workbook = buildWorkbook(report);
    expect(workbook.SheetNames).toEqual(['1天原始数据', '商品综合分析']);
    expect(workbook.Sheets['商品综合分析']['A1'].v).toBe('商品名称');
    expect(workbook.Sheets['商品综合分析']['B1'].v).toBe('管理平台商品ID');
    expect(workbook.Sheets['商品综合分析']['C1'].v).toBe('平台商品ID');
    expect(workbook.Sheets['商品综合分析']['D1'].v).toBe('映射状态');
    expect(workbook.Sheets['商品综合分析']['B2'].v).toBe('jh-9001');
    expect(workbook.Sheets['商品综合分析']['C2'].v).toBe('10001');
    expect(workbook.Sheets['商品综合分析']['!autofilter']).toEqual({ ref: 'A1:U2' });
    expect(workbook.Sheets['商品综合分析']['!cols']).toHaveLength(21);
  });
});
