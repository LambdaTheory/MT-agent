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
  conclusions: [
    { label: '曝光', text: '曝光 1000，较昨日上升 100。' },
    { label: '公域访问', text: '公域访问 50，较昨日上升 10。' },
  ],
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
  newProductObservation: [{ identifier: '端内ID 777', action: '观察 3-7 天，重点看曝光、访问和首单/发货', reason: '今日新进入公域' }],
  lifecycleGovernance: [{ identifier: '端内ID 222', action: '下架、替换或重做素材', reason: '托管久且 30 日表现弱' }],
  recommendedActions: [{ identifier: '端内ID 900', action: '检查价格/押金/库存/风控/履约链路', reason: '访问有发货弱' }],
  emptySectionNotes: {
    lowExposure: '暂无达到阈值的曝光不足商品。',
    weakClick: '暂无达到阈值的高曝光低点击商品。',
    weakConversion: '暂无达到阈值的高访问低转化商品。',
    highPotential: '暂无达到放量阈值的高潜力商品。',
    newProductObservation: '暂无可识别的新进入公域商品，或今日缺少上一日快照。',
    lifecycleGovernance: '暂无达到长期弱表现阈值的托管商品。',
    recommendedActions: '暂无需要立即处理的建议操作。',
  },
};

describe('public traffic report outputs', () => {
  it('builds markdown sections', () => {
    const markdown = buildPublicTrafficMarkdown(context);
    expect(markdown).toContain('# 公域数据日报 2026-06-10');
    expect(markdown).toContain('## 经营结论');
    expect(markdown).toContain('曝光 1000，较昨日上升 100');
    expect(markdown).toContain('## 1日总览');
    expect(markdown).toContain('## 今日曝光 Top10');
    expect(markdown).toContain('端内ID 1001｜公域商品A｜曝光 100｜访问 10｜金额 ¥88.50');
    expect(markdown).not.toContain('## 预警商品（托管>5天 且 曝光<100）');
    expect(markdown).toContain('## 建议操作');
    expect(markdown).toContain('端内ID 900：检查价格/押金/库存/风控/履约链路。原因：访问有发货弱');
    expect(markdown).toContain('## 曝光不足');
    expect(markdown).toContain('端内ID 558');
    expect(markdown).toContain('## 曝光有但点击弱');
    expect(markdown).toContain('## 点击有但转化弱');
    expect(markdown).toContain('## 高潜力商品');
    expect(markdown).toContain('## 新品观察');
    expect(markdown).toContain('端内ID 777');
    expect(markdown).toContain('## 生命周期治理');
    expect(markdown).toContain('端内ID 222');
  });

  it('builds medium-density Feishu text', () => {
    const text = buildPublicTrafficFeishuText(context, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
    expect(text).toContain('公域数据日报 2026-06-10');
    expect(text).toContain('经营结论');
    expect(text).toContain('建议操作');
    expect(text).toContain('今日曝光 Top10');
    expect(text).toContain('端内ID 1001｜公域商品A｜曝光 100｜访问 10｜金额 ¥88.50');
    expect(text).not.toContain('预警商品（托管>5天 且 曝光<100）');
    expect(text).toContain('端内ID 900｜检查价格/押金/库存/风控/履约链路｜访问有发货弱');
    expect(text).toContain('曝光 1000｜公域访问 50｜后链路访问 40｜订单 4｜发货 2｜金额 ¥300.00');
    expect(text).toContain('曝光到访问率 5.00%｜访问到发货率 5.00%');
    expect(text).toContain('曝光不足 1｜点击弱 1｜转化弱 1｜高潜力 1｜新品观察 1｜生命周期治理 1｜建议操作 1');
    expect(text).toContain('转化弱 Top5');
    expect(text).toContain('高潜力 Top5');
    expect(text).toContain('新品观察 Top5');
    expect(text).toContain('生命周期治理 Top5');
    expect(text).toContain('端内ID 900');
    expect(text).not.toContain('Markdown：report.md');
    expect(text).not.toContain('XLSX：report.xlsx');
  });

  it('builds a Feishu card payload', () => {
    const card = buildPublicTrafficCard(context, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
    expect(card.header).toMatchObject({ title: { tag: 'plain_text', content: '公域数据日报 2026-06-10' } });
    const serialized = JSON.stringify(card);
    expect(serialized).toContain('经营结论');
    expect(serialized).toContain('今日曝光 Top10');
    expect(serialized).not.toContain('预警商品（托管>5天 且 曝光<100）');
    expect(serialized).toContain('建议操作');
    expect(serialized).toContain('检查价格/押金/库存/风控/履约链路');
    expect(serialized).toContain('端内ID 558');
    expect(serialized).toContain('新品观察 1');
    expect(serialized).toContain('生命周期治理 1');
    expect(serialized).toContain('高潜力 Top5');
    expect(serialized).toContain('新品观察 Top5');
    expect(serialized).toContain('生命周期治理 Top5');
    expect(serialized).not.toContain('report.md');
    expect(serialized).not.toContain('report.xlsx');
  });

  it('uses column sets to beautify the card summary sections', () => {
    const card = buildPublicTrafficCard(context, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
    const elements = (card.body as { elements: Array<Record<string, unknown>> }).elements;
    const columnSets = elements.filter((element) => element.tag === 'column_set');
    const contents = (columnSet: Record<string, unknown>) =>
      (columnSet.columns as Array<{ elements: Array<{ content: string }> }>).flatMap((column) => column.elements.map((element) => element.content));

    expect(columnSets.length).toBeGreaterThanOrEqual(3);
    expect(contents(columnSets[0])).toContain('**经营结论**');
    expect(contents(columnSets[1])).toContain('曝光\n**1000**');
    expect(contents(columnSets[1])).toContain('金额\n**¥300.00**');
    expect(contents(columnSets[2])).toContain('**模块数量**');
    expect(contents(columnSets[2])).toContain('曝光不足 1');
  });

  it('renders explanatory notes for empty sections', () => {
    const empty: PublicTrafficDataReportContext = {
      ...context,
      recommendedActions: [],
      lowExposure: [],
      weakClick: [],
      weakConversion: [],
      highPotential: [],
      newProductObservation: [],
      lifecycleGovernance: [],
    };
    const markdown = buildPublicTrafficMarkdown(empty);
    expect(markdown).not.toContain('## 建议操作');
    expect(markdown).not.toContain('## 曝光不足');
    expect(markdown).not.toContain('暂无达到阈值');
    const text = buildPublicTrafficFeishuText(empty, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
    expect(text).not.toContain('建议操作\n暂无');
    expect(text).not.toContain('曝光不足 Top5');
    expect(text).not.toContain('暂无达到阈值');

    const serialized = JSON.stringify(buildPublicTrafficCard(empty, { markdownPath: 'report.md', workbookPath: 'report.xlsx' }));
    expect(serialized).not.toContain('曝光不足 Top5');
    expect(serialized).not.toContain('暂无达到阈值');
  });

  it('omits zero-count modules from compact module count line', () => {
    const mixed: PublicTrafficDataReportContext = {
      ...context,
      lowExposure: [],
      weakClick: [],
      highPotential: [],
      lifecycleGovernance: [],
    };

    const text = buildPublicTrafficFeishuText(mixed, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
    expect(text).toContain('模块数量\n转化弱 1｜新品观察 1｜建议操作 1');
    expect(text).not.toContain('曝光不足 0');
    expect(text).not.toContain('点击弱 0');
  });

  it('uses one-day visits to backfill top exposure when same-day exposure is unavailable', () => {
    const fallback: PublicTrafficDataReportContext = {
      ...context,
      rows: [
        {
          platformProductId: 'P-visit',
          displayProductId: '端内ID 888',
          productName: '访问兜底商品',
          custodyDays: null,
          periods: {
            '1d': metrics({ exposure: 0, publicVisits: 0, dashboardVisits: 66, amount: 0, hasExposureData: false, hasDashboardData: true }),
            '7d': metrics({}),
            '30d': metrics({}),
          },
        },
      ],
    };

    expect(buildPublicTrafficFeishuText(fallback, { markdownPath: 'report.md', workbookPath: 'report.xlsx' })).toContain('端内ID 888｜访问兜底商品｜曝光 0｜访问 66｜金额 ¥0.00');
  });

  it('renders warning products with internal id first', () => {
    const warning: PublicTrafficDataReportContext = {
      ...context,
      rows: [
        {
          platformProductId: 'P-warning',
          displayProductId: '端内ID 284',
          productName: '预警商品A',
          custodyDays: 12,
          periods: {
            '1d': metrics({ exposure: 9, publicVisits: 1, dashboardVisits: 1, amount: 0 }),
            '7d': metrics({}),
            '30d': metrics({}),
          },
        },
      ],
    };

    const text = buildPublicTrafficFeishuText(warning, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
    expect(text).toContain('预警商品（托管>5天 且 曝光<100）');
    expect(text).toContain('端内ID 284｜预警商品A｜曝光 9｜访问 1｜金额 ¥0.00｜托管 12天');
    expect(text).not.toContain('预警商品A (端内ID 284)');
  });

  it('renders dashboard freshness notes in compact outputs', () => {
    const stale: PublicTrafficDataReportContext = {
      ...context,
      dataQualityNotes: ['今日访问数据支付宝暂未更新，本期访问量板块指标缺失。'],
    };

    expect(buildPublicTrafficMarkdown(stale)).toContain('## 数据提示\n今日访问数据支付宝暂未更新，本期访问量板块指标缺失。');
    expect(buildPublicTrafficFeishuText(stale, { markdownPath: 'report.md', workbookPath: 'report.xlsx' })).toContain('数据提示\n今日访问数据支付宝暂未更新，本期访问量板块指标缺失。');
    expect(JSON.stringify(buildPublicTrafficCard(stale, { markdownPath: 'report.md', workbookPath: 'report.xlsx' }))).toContain('今日访问数据支付宝暂未更新，本期访问量板块指标缺失。');
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
    expect(text).toContain('5. 端内ID 5｜曝光不足｜原因5');
    expect(text).not.toContain('6. 端内ID 6');
  });

  it('writes a workbook buffer with expected sheet names and recommended actions', () => {
    const buffer = writePublicTrafficWorkbookBuffer(context);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    expect(workbook.SheetNames).toEqual(['总览', '建议操作', '商品明细', '曝光不足', '点击弱', '转化弱', '高潜力', '新品观察', '生命周期治理']);
    const overview = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['总览']);
    expect(overview[0]).toMatchObject({ period: '1d', exposure: 1000 });
    const recommendedActions = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['建议操作']);
    expect(recommendedActions[0]).toMatchObject({
      identifier: '端内ID 900',
      action: '检查价格/押金/库存/风控/履约链路',
      reason: '访问有发货弱',
    });
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

  it('writes explanatory notes for empty workbook sections', () => {
    const empty: PublicTrafficDataReportContext = {
      ...context,
      recommendedActions: [],
      lowExposure: [],
      weakClick: [],
      weakConversion: [],
      highPotential: [],
      newProductObservation: [],
      lifecycleGovernance: [],
    };
    const workbook = XLSX.read(writePublicTrafficWorkbookBuffer(empty), { type: 'buffer' });

    const recommendedActions = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['建议操作']);
    expect(recommendedActions[0]).toMatchObject({ note: '暂无需要立即处理的建议操作。' });
    const lowExposure = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['曝光不足']);
    expect(lowExposure[0]).toMatchObject({ note: '暂无达到阈值的曝光不足商品。' });
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

  it('renders legacy Markdown and Feishu text with neutral insight defaults', () => {
    const legacy: PublicTrafficReportContext = {
      date: '2026-06-10',
      overview: [
        { period: '7d', exposure: 70000, visits: 700, conversionRate: 1, amount: 7000 },
        { period: '1d', exposure: 48103, visits: 1591, conversionRate: 3.31, amount: 3018.8 },
        { period: '30d', exposure: 300000, visits: 3000, conversionRate: 1, amount: 30000 },
      ],
      exposureOptimization: [],
      conversionOptimization: [],
      newProductObservation: [],
      lifecycleGovernance: [],
    };

    const markdown = buildPublicTrafficMarkdown(legacy);
    expect(markdown).toContain('## 经营结论');
    expect(markdown).toContain('暂无昨日公域数据上下文');
    expect(markdown).toContain('今日仅展示基准值：曝光 48103。');
    expect(markdown).not.toContain('今日仅展示基准值：曝光 70000。');
    expect(markdown).not.toContain('## 建议操作');

    const text = buildPublicTrafficFeishuText(legacy, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
    expect(text).toContain('经营结论');
    expect(text).toContain('暂无昨日公域数据上下文');
    expect(text).toContain('今日仅展示基准值：曝光 48103。');
    expect(text).not.toContain('今日仅展示基准值：曝光 70000。');
    expect(text).not.toContain('建议操作\n暂无需要立即处理的建议操作。');
  });
});
