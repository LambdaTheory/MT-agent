import { describe, expect, it } from 'vitest';
import XLSX from 'xlsx-js-style';
import { buildPublicTrafficCard } from '../src/publicTraffic/buildPublicTrafficCard.js';
import { buildPublicTrafficFeishuText } from '../src/publicTraffic/buildPublicTrafficFeishu.js';
import { buildPublicTrafficMarkdown } from '../src/publicTraffic/buildPublicTrafficMarkdown.js';
import { writePublicTrafficWorkbookBuffer } from '../src/publicTraffic/buildPublicTrafficWorkbook.js';
import type { PublicTrafficDataReportContext, PublicTrafficPeriodMetrics, PublicTrafficReportContext } from '../src/publicTraffic/types.js';

function metrics(overrides: Partial<PublicTrafficPeriodMetrics>): PublicTrafficPeriodMetrics {
  return {
    exposure: 0,
    publicVisits: 0,
    dashboardVisits: 0,
    createdOrders: 0,
    signedOrders: 0,
    reviewedOrders: 0,
    shippedOrders: 0,
    amount: 0,
    exposureVisitRate: 0,
    visitCreatedOrderRate: 0,
    visitShipmentRate: 0,
    hasExposureData: true,
    hasDashboardData: true,
    ...overrides,
  };
}

const context: PublicTrafficDataReportContext = {
  date: '2026-06-10',
  summary: {
    '1d': { exposure: 1000, publicVisits: 50, dashboardVisits: 40, createdOrders: 4, shippedOrders: 2, amount: 300, exposureVisitRate: 0.05, visitCreatedOrderRate: 0.1, visitShipmentRate: 0.05 },
    '7d': { exposure: 7000, publicVisits: 350, dashboardVisits: 280, createdOrders: 20, shippedOrders: 10, amount: 1500, exposureVisitRate: 0.05, visitCreatedOrderRate: 0.0714, visitShipmentRate: 0.0357 },
    '30d': { exposure: 30000, publicVisits: 1500, dashboardVisits: 1200, createdOrders: 80, shippedOrders: 40, amount: 6000, exposureVisitRate: 0.05, visitCreatedOrderRate: 0.0667, visitShipmentRate: 0.0333 },
  },
  rows: [
    {
      platformProductId: 'P-1001',
      displayProductId: '端内ID 1001',
      productName: '公域商品A',
      custodyDays: 12,
      periods: {
        '1d': metrics({ exposure: 100, publicVisits: 10, dashboardVisits: 8, createdOrders: 2, signedOrders: 2, reviewedOrders: 1, shippedOrders: 1, amount: 88.5, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.25, visitShipmentRate: 0.125 }),
        '7d': metrics({ exposure: 700, publicVisits: 70, dashboardVisits: 56, createdOrders: 14, signedOrders: 12, reviewedOrders: 9, shippedOrders: 7, amount: 688.5, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.25, visitShipmentRate: 0.125 }),
        '30d': metrics({ exposure: 3000, publicVisits: 300, dashboardVisits: 240, createdOrders: 60, signedOrders: 50, reviewedOrders: 40, shippedOrders: 30, amount: 2888.5, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.25, visitShipmentRate: 0.125 }),
      },
    },
  ],
  lowExposure: [{ identifier: '端内ID 558', action: '曝光不足', reason: '1日曝光 10' }],
  weakClick: [{ identifier: '端内ID 421', action: '曝光有但点击弱', reason: '访问率低' }],
  weakConversion: [{ identifier: '端内ID 900', action: '点击有但转化弱', reason: '访问有发货弱' }],
  highPotential: [{ identifier: '端内ID 333', action: '高潜力商品', reason: '可继续放量' }],
  newProductObservation: [],
  lifecycleGovernance: [],
};

describe('public traffic report outputs', () => {
  it('builds markdown sections', () => {
    const markdown = buildPublicTrafficMarkdown(context);
    expect(markdown).toContain('# 公域数据日报 2026-06-10');
    expect(markdown).toContain('## 1日总览');
    expect(markdown).toContain('## 曝光不足');
    expect(markdown).toContain('端内ID 558');
  });

  it('builds medium-density Feishu text', () => {
    const text = buildPublicTrafficFeishuText(context, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
    expect(text).toContain('公域数据日报 2026-06-10');
    expect(text).toContain('曝光：1000');
    expect(text).toContain('曝光不足：1个');
    expect(text).toContain('转化弱 Top5');
    expect(text).toContain('端内ID 900');
    expect(text).toContain('Markdown：report.md');
  });

  it('builds a Feishu card payload', () => {
    const card = buildPublicTrafficCard(context, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
    expect(card.header).toMatchObject({ title: { tag: 'plain_text', content: '公域数据日报 2026-06-10' } });
    expect(JSON.stringify(card)).toContain('端内ID 558');
  });

  it('renders 无 fallback for empty sections', () => {
    const empty: PublicTrafficDataReportContext = {
      ...context,
      lowExposure: [],
      weakClick: [],
      weakConversion: [],
      highPotential: [],
      newProductObservation: [],
      lifecycleGovernance: [],
    };
    const markdown = buildPublicTrafficMarkdown(empty);
    expect(markdown).toContain('## 曝光不足\n无');
    const text = buildPublicTrafficFeishuText(empty, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
    expect(text).toContain('曝光不足 Top5\n无');
  });

  it('truncates Feishu top5 to five items', () => {
    const many: PublicTrafficDataReportContext = {
      ...context,
      lowExposure: Array.from({ length: 8 }, (_, i) => ({
        identifier: `端内ID ${i + 1}`,
        action: '曝光不足',
        reason: `原因${i + 1}`,
      })),
    };
    const text = buildPublicTrafficFeishuText(many, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
    expect(text).toContain('5. 端内ID 5｜原因5');
    expect(text).not.toContain('6. 端内ID 6');
  });

  it('writes a workbook buffer with expected sheet names', () => {
    const buffer = writePublicTrafficWorkbookBuffer(context);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    expect(workbook.SheetNames).toEqual(['总览', '商品明细', '曝光不足', '点击弱', '转化弱', '高潜力', '新品观察', '生命周期治理']);
    const overview = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['总览']);
    expect(overview[0]).toMatchObject({ period: '1d', exposure: 1000 });
    const detail = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['商品明细']);
    expect(detail[0]).toMatchObject({
      platformProductId: 'P-1001',
      displayProductId: '端内ID 1001',
      '1d_publicVisits': 10,
      '1d_createdOrders': 2,
      '1d_signedOrders': 2,
      '1d_reviewedOrders': 1,
      '1d_amount': 88.5,
      '1d_exposureVisitRate': 0.1,
      '7d_dashboardVisits': 56,
      '7d_signedOrders': 12,
      '7d_reviewedOrders': 9,
      '7d_shippedOrders': 7,
      '7d_visitShipmentRate': 0.125,
      '30d_publicVisits': 300,
      '30d_createdOrders': 60,
      '30d_signedOrders': 50,
      '30d_reviewedOrders': 40,
      '30d_amount': 2888.5,
    });
  });

  it('keeps legacy workbook sheets for legacy report context', () => {
    const legacy: PublicTrafficReportContext = {
      date: '2026-06-10',
      overview: [{ period: '1d', exposure: 48103, visits: 1591, conversionRate: 3.31, amount: 3018.8 }],
      exposureOptimization: [{ identifier: '端内ID 558', action: '曝光优化', reason: '高曝光低访问' }],
      conversionOptimization: [{ identifier: '端内ID 421', action: '转化优化', reason: '有访问无金额' }],
      newProductObservation: [{ identifier: '端内ID 900', action: '新品观察', reason: '新品未进推广' }],
      lifecycleGovernance: [{ identifier: '端内ID 333', action: '生命周期治理', reason: '托管久且低曝光' }],
    };
    const workbook = XLSX.read(writePublicTrafficWorkbookBuffer(legacy), { type: 'buffer' });
    expect(workbook.SheetNames).toEqual(['总览', '曝光优化', '转化优化', '新品观察', '生命周期治理']);
    const overview = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['总览']);
    expect(overview[0]).toMatchObject({ period: '1d', exposure: 48103, visits: 1591 });
  });
});
