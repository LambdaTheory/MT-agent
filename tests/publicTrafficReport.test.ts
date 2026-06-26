import { describe, expect, it } from 'vitest';
import XLSX from 'xlsx-js-style';
import { analyzePublicTrafficData } from '../src/publicTraffic/analyzePublicTrafficData.js';
import { buildPublicTrafficCard } from '../src/publicTraffic/buildPublicTrafficCard.js';
import { buildPublicTrafficFeishuText } from '../src/publicTraffic/buildPublicTrafficFeishu.js';
import { buildPublicTrafficMarkdown } from '../src/publicTraffic/buildPublicTrafficMarkdown.js';
import { writePublicTrafficWorkbookBuffer } from '../src/publicTraffic/buildPublicTrafficWorkbook.js';
import type { OrderAnalysisResult } from '../src/publicTraffic/orderAnalysis.js';
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
        '1d': metrics({ exposure: 100, publicVisits: 10, dashboardVisits: 8, createdOrders: 2, signedOrders: 2, reviewedOrders: 1, shippedOrders: 1, amount: 88.5, createdOrderAmount: 120.5, signedOrderAmount: 99, reviewedOrderAmount: 88, shippedOrderAmount: 77, exposureVisitRate: 0.1, visitCreatedOrderRate: 0.25, visitShipmentRate: 0.125 }),
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

const contextWithOrderAnalysis: PublicTrafficDataReportContext = {
  ...context,
  orderAnalysis: {
    capturedAt: '2026-06-12T00:00:00.000Z',
    runDate: '2026-06-12',
    pages: {
      overview: {
        key: 'overview',
        label: '标准订单分析',
        dataDate: '2026-06-10',
        indicators: [
          { label: '创建订单数', value: '194', delta: '较前日+71.7%' },
          { label: '签约订单数', value: '103', delta: '较前日+32.1%' },
          { label: '发货订单数', value: '64', delta: '较前日-4.48%' },
          { label: '签约完成金额（元）', value: '3,977', delta: '较前日-25.6%' },
        ],
      },
      delivery: {
        key: 'delivery',
        label: '发货分析',
        dataDate: '2026-06-10',
        indicators: [
          { label: '发货订单数', value: '64', delta: '较前日-4.48%' },
          { label: '待发货订单数', value: '168', delta: '较前日-34.4%' },
        ],
      },
      return: {
        key: 'return',
        label: '归还分析',
        dataDate: null,
        indicators: [
          { label: '归还订单数', value: '15', delta: '较前日-12.8%' },
          { label: '逾期订单数', value: '5', delta: '较前日+28.6%' },
        ],
      },
      customs: { key: 'customs', label: '关单分析', dataDate: '2026-06-10', indicators: [{ label: '关单数', value: '90', delta: '较前日+31.0%' }] },
    },
  },
};

function makeDataReportContext(overrides: Partial<PublicTrafficDataReportContext>): PublicTrafficDataReportContext {
  return { ...context, ...overrides };
}

function makeOrderAnalysisResult(indicators: OrderAnalysisResult['pages']['overview']['indicators']): OrderAnalysisResult {
  return {
    capturedAt: '2026-06-12T00:00:00.000Z',
    runDate: '2026-06-12',
    pages: {
      overview: { key: 'overview', label: '标准订单分析', dataDate: '2026-06-10', indicators },
      delivery: { key: 'delivery', label: '发货分析', dataDate: '2026-06-10', indicators: [] },
      return: { key: 'return', label: '归还分析', dataDate: null, indicators: [] },
      customs: { key: 'customs', label: '关单分析', dataDate: '2026-06-10', indicators: [] },
    },
  };
}

function findCardElementsByTag(card: { body?: { elements?: unknown[] } }, tag: string): Record<string, unknown>[] {
  return (card.body?.elements ?? []).filter((element): element is Record<string, unknown> => {
    return Boolean(element && typeof element === 'object' && (element as Record<string, unknown>).tag === tag);
  });
}

function tableRows(table: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(table.rows) ? (table.rows as Record<string, unknown>[]) : [];
}

describe('public traffic report outputs', () => {
  it('does not truncate diagnostic sections in analysis output', () => {
    const rows = Array.from({ length: 7 }, (_, index) => ({
      platformProductId: `P-low-${index}`,
      displayProductId: `端内ID ${1000 + index}`,
      productName: `低曝光商品${index}`,
      custodyDays: 12,
      periods: {
        '1d': metrics({ exposure: 10 + index, publicVisits: 0, dashboardVisits: 0, shippedOrders: 0 }),
        '7d': metrics({ exposure: 70 + index, publicVisits: 0, dashboardVisits: 0, shippedOrders: 0 }),
        '30d': metrics({ exposure: 300 + index, publicVisits: 0, dashboardVisits: 0, shippedOrders: 0 }),
      },
    }));

    const report = analyzePublicTrafficData({ date: '2026-06-10', rows });

    expect(report.lowExposure).toHaveLength(7);
  });

  it('builds markdown sections', () => {
    const markdown = buildPublicTrafficMarkdown(context);
    expect(markdown).toContain('# 公域数据日报 2026-06-10');
    expect(markdown).toContain('## 经营结论');
    expect(markdown).toContain('曝光 1000，较昨日上升 100');
    expect(markdown).toContain('## 1日总览');
    expect(markdown).toContain('## 今日曝光 Top10');
    expect(markdown).toContain('端内ID 1001｜公域商品A｜曝光 100｜公域访问 10｜公域金额 ¥88.50');
    expect(markdown).not.toContain('## 预警商品（托管>5天 且 曝光<100）');
    expect(markdown).toContain('## 诊断问题');
    expect(markdown).toContain('| 类型 | 商品 | 操作 | 原因 |');
    expect(markdown).toContain('| 曝光不足 | 端内ID 558 | 曝光不足 | 1日曝光 10 |');
    expect(markdown).toContain('| 转化弱 | 端内ID 900 | 点击有但转化弱 | 访问有发货弱 |');
    expect(markdown).toContain('## 建议操作');
    expect(markdown).toContain('| 操作 | 商品 | 原因 |');
    expect(markdown).toContain('| 检查价格/押金/库存/风控/履约链路 | 端内ID 900 | 访问有发货弱 |');
    expect(markdown).toContain('## 新品观察');
    expect(markdown).toContain('| 端内ID 777 | 观察 3-7 天，重点看曝光、访问和首单/发货 | 今日新进入公域 |');
    expect(markdown).not.toContain('## 曝光不足');
    expect(markdown).not.toContain('## 曝光有但点击弱');
    expect(markdown).not.toContain('## 点击有但转化弱');
    expect(markdown).not.toContain('## 高潜力商品');
    expect(markdown).not.toContain('## 生命周期治理');
  });

  it('keeps only exposure Top10 wording and places new products last in Markdown', () => {
    const markdown = buildPublicTrafficMarkdown(makeDataReportContext({
      lowExposure: [{ identifier: 'A', action: '补曝光', reason: '曝光低' }],
      weakClick: [],
      weakConversion: [{ identifier: 'B', action: '提转化', reason: '转化弱' }],
      highPotential: [],
      lifecycleGovernance: [],
      recommendedActions: [{ identifier: 'B', action: '提转化', reason: '转化弱' }],
      newProductObservation: [{ identifier: 'C', action: '新品数据监控', reason: '新品' }],
    }));

    expect(markdown).toContain('## 今日曝光 Top10');
    expect(markdown).not.toContain('Top5');
    expect(markdown.indexOf('## 建议操作')).toBeLessThan(markdown.indexOf('## 新品观察'));
    expect(markdown.trim().endsWith('| C | 新品数据监控 | 新品 |')).toBe(true);
  });

  it('escapes pipe and newline characters in Markdown table cells', () => {
    const markdown = buildPublicTrafficMarkdown(makeDataReportContext({
      lowExposure: [{ identifier: 'ID|1\nline2', action: 'act|a', reason: 'r\neason' }],
      weakClick: [],
      weakConversion: [],
      highPotential: [],
      lifecycleGovernance: [],
      recommendedActions: [],
      newProductObservation: [],
    }));

    expect(markdown).toContain('| 曝光不足 | ID｜1 line2 | act｜a | r eason |');
    expect(markdown).not.toContain('ID|1');
    expect(markdown).not.toContain('\nline2');
  });

  it('builds medium-density Feishu text', () => {
    const text = buildPublicTrafficFeishuText(contextWithOrderAnalysis, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
    expect(text).toContain('公域数据日报 2026-06-10');
    expect(text).toContain('经营结论');
    expect(text).toContain('建议操作');
    expect(text).toContain('今日曝光 Top10');
    expect(text).toContain('端内ID 1001｜公域商品A｜曝光 100｜公域访问 10｜公域金额 ¥88.50');
    expect(text).not.toContain('预警商品（托管>5天 且 曝光<100）');
    expect(text).toContain('诊断问题');
    expect(text).toContain('3. 转化弱｜端内ID 900｜点击有但转化弱｜访问有发货弱');
    expect(text).toContain('1. 检查价格/押金/库存/风控/履约链路｜端内ID 900｜访问有发货弱');
    expect(text).toContain('曝光 1000｜公域访问 50｜公域金额 ¥300.00｜转化率 5.00%');
    expect(text).toContain('订单经营');
    expect(text).toContain('创建订单 194');
    expect(text).toContain('签约订单 103');
    expect(text).toContain('发货订单 64');
    expect(text).toContain('关单 90');
    expect(text).toContain('发货率');
    expect(text).toContain('关单率');
    expect(text).toContain('客单价');
    expect(text).not.toContain('审出订单');
    expect(text).toContain('曝光不足 1｜点击弱 1｜转化弱 1｜高潜力 1｜新品观察 1｜生命周期治理 1｜建议操作 1');
    expect(text).not.toContain('转化弱 Top5');
    expect(text).not.toContain('高潜力 Top5');
    expect(text).not.toContain('新品观察 Top5');
    expect(text).not.toContain('生命周期治理 Top5');
    expect(text).toContain('端内ID 900');
    expect(text).not.toContain('Markdown：report.md');
    expect(text).not.toContain('XLSX：report.xlsx');
  });

  it('renders abnormal custody status in report outputs', () => {
    const withCustodyAbnormal = makeDataReportContext({
      custodyAbnormal: [
        {
          identifier: '端内ID 733',
          action: '检查托管异常',
          reason: '大疆 Pocket3｜托管状态：托管异常',
          priority: 'high',
        },
      ],
    });

    const markdown = buildPublicTrafficMarkdown(withCustodyAbnormal);
    expect(markdown).toContain('## 托管异常');
    expect(markdown).toContain('| 商品 | 操作 | 原因 |');
    expect(markdown).toContain('| 端内ID 733 | 检查托管异常 | 大疆 Pocket3｜托管状态：托管异常 |');

    const text = buildPublicTrafficFeishuText(withCustodyAbnormal, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
    expect(text).toContain('托管异常 1');
    expect(text).toContain('托管异常\n1. 端内ID 733｜检查托管异常｜大疆 Pocket3｜托管状态：托管异常');

    const cardJson = JSON.stringify(buildPublicTrafficCard(withCustodyAbnormal, { markdownPath: 'report.md', workbookPath: 'report.xlsx' }));
    expect(cardJson).toContain('托管异常');
    expect(cardJson).toContain('custody_abnormal_table');
    expect(cardJson).toContain('端内ID 733');

    const workbook = XLSX.read(writePublicTrafficWorkbookBuffer(withCustodyAbnormal), { type: 'buffer' });
    expect(workbook.SheetNames).toContain('托管异常');
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['托管异常']);
    expect(rows[0]).toMatchObject({
      identifier: '端内ID 733',
      action: '检查托管异常',
      reason: '大疆 Pocket3｜托管状态：托管异常',
    });
  });

  it('builds a Feishu card payload', () => {
    const card = buildPublicTrafficCard(context, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
    expect(card.header).toMatchObject({ title: { tag: 'plain_text', content: '公域数据日报 2026-06-10' } });
    const serialized = JSON.stringify(card);
    expect(serialized).not.toContain('经营结论');
    expect(serialized).not.toContain('今日漏斗');
    expect(serialized).not.toContain('**公域**');
    expect(serialized).toContain('曝光 Top10');
    expect(serialized).not.toContain('预警商品（托管>5天 且 曝光<100）');
    expect(serialized).toContain('分析与建议');
    expect(serialized).toContain('动作聚焦');
    expect(serialized).not.toContain('新品观察 1');
    expect(serialized).not.toContain('生命周期治理 1');
    expect(serialized).toContain('exposure_top_table');
    expect(serialized).not.toContain('boost_table');
    expect(serialized).not.toContain('conversion_table');
    expect(serialized).not.toContain('scale_table');
    expect(serialized).not.toContain('new_table');
    expect(serialized).not.toContain('高潜力 Top5');
    expect(serialized).not.toContain('新品观察 Top5');
    expect(serialized).not.toContain('生命周期治理 Top5');
    expect(serialized).not.toContain('report.md');
    expect(serialized).not.toContain('report.xlsx');
  });

  it.each([
    { hasExposureData: true, hasDashboardData: true, template: 'green', text: '数据源状态：曝光页已抓取；访问页已抓取' },
    { hasExposureData: true, hasDashboardData: false, template: 'blue', text: '数据源状态：曝光页已抓取；访问页未更新/异常' },
    { hasExposureData: false, hasDashboardData: true, template: 'orange', text: '数据源状态：曝光页未更新/异常；访问页已抓取' },
    { hasExposureData: false, hasDashboardData: false, template: 'red', text: '数据源状态：曝光页未更新/异常；访问页未更新/异常' },
  ])('renders source status as $template when exposure=$hasExposureData dashboard=$hasDashboardData', ({ hasExposureData, hasDashboardData, template, text }) => {
    const sourceContext = makeDataReportContext({
      rows: context.rows.map((row) => ({
        ...row,
        periods: {
          ...row.periods,
          '1d': {
            ...row.periods['1d'],
            hasExposureData,
            hasDashboardData,
          },
        },
      })),
    });

    const card = buildPublicTrafficCard(sourceContext, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });

    expect(card.header).toMatchObject({ template });
    expect(JSON.stringify(card)).toContain(text);
  });

  it('keeps removed-link Agent data out of visible Markdown and Feishu card outputs', () => {
    const withRemovedLinks: PublicTrafficDataReportContext = {
      ...context,
      agentData: {
        removedLinks: [
          { productId: '701', platformProductId: 'p701', productName: '已下架链接', removedDate: '2026-06-12', reason: '商品总表缺失', source: 'goods_snapshot_diff' },
        ],
      },
    };

    expect(buildPublicTrafficMarkdown(withRemovedLinks)).not.toContain('已下架链接');
    expect(JSON.stringify(buildPublicTrafficCard(withRemovedLinks, { markdownPath: 'report.md', workbookPath: 'report.xlsx' }))).not.toContain('已下架链接');
    expect(buildPublicTrafficFeishuText(withRemovedLinks, { markdownPath: 'report.md', workbookPath: 'report.xlsx' })).not.toContain('已下架链接');
  });

  it('uses manual product short names only in Feishu card tables', () => {
    const card = buildPublicTrafficCard(context, { markdownPath: 'report.md', workbookPath: 'report.xlsx' }, { productNameMap: { '1001': '佳能 SX70' } });
    const serialized = JSON.stringify(card);

    expect(serialized).toContain('佳能 SX70');
    expect(serialized).not.toContain('公域商品A');
    expect(buildPublicTrafficMarkdown(context)).toContain('公域商品A');
  });

  it('cleans noisy product names and falls back to ID for empty names in Feishu card tables', () => {
    const noisyContext = makeDataReportContext({
      rows: [
        {
          platformProductId: 'P-251',
          displayProductId: '端内ID 251',
          productName: '佳能 SX70 65倍长焦4K相机演唱会出游日常记录出片神器芝麻免押租赁 ZFB',
          custodyDays: 12,
          periods: {
            '1d': metrics({ exposure: 120, publicVisits: 4, dashboardVisits: 4, shippedOrders: 0 }),
            '7d': metrics({ exposure: 700, publicVisits: 20, dashboardVisits: 18, shippedOrders: 1 }),
            '30d': metrics({ exposure: 3000, publicVisits: 80, dashboardVisits: 70, shippedOrders: 3 }),
          },
        },
        {
          platformProductId: 'P-empty',
          displayProductId: '端内ID 999',
          productName: '  ',
          custodyDays: 12,
          periods: {
            '1d': metrics({ exposure: 80, publicVisits: 1, dashboardVisits: 1, shippedOrders: 0 }),
            '7d': metrics({ exposure: 300, publicVisits: 10, dashboardVisits: 8, shippedOrders: 0 }),
            '30d': metrics({ exposure: 1200, publicVisits: 40, dashboardVisits: 30, shippedOrders: 1 }),
          },
        },
      ],
      weakConversion: [],
      highPotential: [],
      newProductObservation: [],
      recommendedActions: [],
    });

    const serialized = JSON.stringify(buildPublicTrafficCard(noisyContext, { markdownPath: 'report.md', workbookPath: 'report.xlsx' }));

    expect(serialized).toContain('佳能 SX70');
    expect(serialized).not.toContain('演唱会');
    expect(serialized).not.toContain('芝麻免押');
    expect(serialized).toContain('端内ID 999');
  });

  it('renders full diagnostic sections as paginated root-level Feishu tables', () => {
    const context = makeDataReportContext({
      conclusions: [
        { label: '曝光', text: '曝光 100，较昨日上升 10' },
        { label: '公域访问', text: '公域访问 20，较昨日上升 2' },
        { label: '金额', text: '金额 30元，较昨日上升 3元' },
      ],
      lowExposure: [
        { identifier: '重复商品', action: '检查托管状态', reason: '低曝光原因' },
        ...Array.from({ length: 6 }, (_, index) => ({ identifier: `低曝光${index}`, action: '检查托管状态', reason: `低曝光原因${index}` })),
      ],
      weakClick: Array.from({ length: 6 }, (_, index) => ({ identifier: `点击弱${index}`, action: '优化主图', reason: `点击弱原因${index}` })),
      weakConversion: [
        { identifier: '重复商品', action: '检查价格', reason: '转化弱原因' },
        ...Array.from({ length: 6 }, (_, index) => ({ identifier: `转化弱${index}`, action: '检查价格', reason: `转化弱原因${index}` })),
      ],
      highPotential: Array.from({ length: 2 }, (_, index) => ({ identifier: `高潜力${index}`, action: '继续放量', reason: `高潜力原因${index}` })),
      lifecycleGovernance: Array.from({ length: 2 }, (_, index) => ({ identifier: `治理${index}`, action: '下架或重做', reason: `治理原因${index}` })),
      recommendedActions: [
        { identifier: '重复商品', action: '检查价格', reason: '转化弱原因' },
        ...Array.from({ length: 12 }, (_, index) => ({ identifier: `建议${index}`, action: index % 2 === 0 ? '检查价格' : '优化主图', reason: `建议原因${index}` })),
      ],
      newProductObservation: Array.from({ length: 11 }, (_, index) => ({ identifier: `新品${index}`, action: '新品数据监控', reason: `新品原因${index}` })),
    });
    const expectedDiagnosticRows = context.lowExposure.length + context.weakClick.length + context.weakConversion.length + context.highPotential.length + context.lifecycleGovernance.length;
    const expectedActionRows = context.recommendedActions.length;
    const expectedNewProductRows = context.newProductObservation.length;

    const card = buildPublicTrafficCard(context, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
    const tables = findCardElementsByTag(card, 'table');

    expect(tables).toHaveLength(1);
    const allColumns = tables.flatMap((table) => table.columns as Array<{ name: string; display_name: string }>);
    expect(allColumns.map((column) => column.name)).not.toContain('reason');
    expect(JSON.stringify(card)).not.toContain('new_table');

    expect(tables.every((table) => table.page_size === 10)).toBe(true);
    expect(tables.every((table) => table.row_height === 'low')).toBe(true);
    expect(tables.every((table) => table.freeze_first_column === true)).toBe(true);
    expect(expectedDiagnosticRows).toBeGreaterThan(0);
    expect(expectedActionRows).toBeGreaterThan(0);
    expect(expectedNewProductRows).toBeGreaterThan(0);

    expect(tables[0].element_id).toBe('exposure_top_table');
    expect((tables[0].columns as Array<{ display_name: string }>).map((column) => column.display_name)).toEqual(['商品', 'ID', '曝光', '公域访问', '公域金额']);
    expect(tableRows(tables[0])[0]).toMatchObject({ product: expect.any(String), id: expect.any(String), exposure: expect.any(Number), visits: expect.any(Number), amount: expect.any(Number) });

    expect(tables.slice(1).map((table) => table.element_id)).toEqual([]);

    const cardText = JSON.stringify(card);
    expect(cardText).toContain('曝光 100，较昨日上升 10');
    expect(cardText).toContain('公域访问 20，较昨日上升 2');
    expect(cardText).toContain('金额 30元，较昨日上升 3元');
    expect(cardText).toContain('曝光 Top10');
    expect(cardText).not.toContain('待优化');
    expect(cardText).not.toContain('补曝光（0）');
    expect(cardText).not.toContain('提转化（0）');
    expect(cardText).not.toContain('继续放量（0）');
    expect(cardText).toContain('分析与建议');
    expect(cardText).toContain('collapsible_panel');
    expect(cardText).not.toContain('曝光不足 Top5');
    expect(cardText).not.toContain('点击弱 Top5');
    expect(cardText).not.toContain('转化弱 Top5');
    expect(cardText).not.toContain('高潜力 Top5');
    expect(cardText).not.toContain('新品观察 Top5');
    expect(cardText).not.toContain('生命周期治理 Top5');
  });

  it('uses compact summary sections in the card', () => {
    const card = buildPublicTrafficCard(context, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
    const elements = (card.body as { elements: Array<Record<string, unknown>> }).elements;
    const columnSets = elements.filter((element) => element.tag === 'column_set');
    const markdowns = elements.filter((element) => element.tag === 'markdown') as Array<{ content: string }>;
    const contents = (columnSet: Record<string, unknown>) =>
      (columnSet.columns as Array<{ elements: Array<{ content: string }> }>).flatMap((column) => column.elements.map((element) => element.content));

    expect(JSON.stringify(card)).not.toContain('经营结论');
    expect(JSON.stringify(card)).not.toContain('今日漏斗');
    expect(JSON.stringify(card)).not.toContain('**公域**');
    expect(JSON.stringify(columnSets[0])).toContain('转化率\\n**5.00%**');
    expect(columnSets.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(columnSets[0])).toContain('曝光\\n**1000**');
    expect(JSON.stringify(columnSets[0])).toContain('公域访问\\n**50**');
    expect(JSON.stringify(columnSets[0])).toContain('公域金额\\n**¥300.00**');
  });

  it('renders public funnel date title and previous-day percentages in metric cards', () => {
    const withPrevious: PublicTrafficDataReportContext = {
      ...contextWithOrderAnalysis,
      previousSummary: {
        exposure: 800,
        publicVisits: 40,
        dashboardVisits: 30,
        createdOrders: 3,
        shippedOrders: 2,
        amount: 200,
        exposureVisitRate: 0.04,
        visitCreatedOrderRate: 0.1,
        visitShipmentRate: 0.0667,
      },
    };

    const card = buildPublicTrafficCard(withPrevious, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
    const json = JSON.stringify(card);

    expect(json).toContain('公域（06-10）');
    expect(json).not.toContain('公域 1日');
    expect(json.match(/较前日\+25\.00%/g)).toHaveLength(3);
    expect(json).toContain('较前日+50.00%');
    expect(json).toContain('发货率');
    expect(json).toContain('较前日-44.37%');
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

    expect(buildPublicTrafficFeishuText(fallback, { markdownPath: 'report.md', workbookPath: 'report.xlsx' })).toContain('端内ID 888｜访问兜底商品｜曝光 0｜公域访问 0｜公域金额 ¥0.00');
  });

  it('renders top exposure products with internal id first', () => {
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
    expect(text).not.toContain('预警商品（托管>5天 且 曝光<100）');
    expect(text).toContain('端内ID 284｜预警商品A｜曝光 9｜公域访问 1｜公域金额 ¥0.00');
    expect(text).not.toContain('预警商品A (端内ID 284)');
  });

  it('keeps dashboard freshness notes out of visible public report outputs', () => {
    const stale: PublicTrafficDataReportContext = {
      ...context,
      dataQualityNotes: ['今日访问数据支付宝暂未更新，本期访问量板块指标缺失。'],
    };

    expect(buildPublicTrafficMarkdown(stale)).not.toContain('今日访问数据支付宝暂未更新，本期访问量板块指标缺失。');
    expect(buildPublicTrafficFeishuText(stale, { markdownPath: 'report.md', workbookPath: 'report.xlsx' })).not.toContain('今日访问数据支付宝暂未更新，本期访问量板块指标缺失。');
    expect(JSON.stringify(buildPublicTrafficCard(stale, { markdownPath: 'report.md', workbookPath: 'report.xlsx' }))).not.toContain('今日访问数据支付宝暂未更新，本期访问量板块指标缺失。');
  });

  it('does not truncate Feishu diagnostic items', () => {
    const many: PublicTrafficDataReportContext = {
      ...context,
      lowExposure: Array.from({ length: 8 }, (_, i) => ({
        identifier: `端内ID ${i + 1}`,
        action: '曝光不足',
        reason: `原因${i + 1}`,
      })),
    };
    const text = buildPublicTrafficFeishuText(many, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
    expect(text).toContain('5. 曝光不足｜端内ID 5｜曝光不足｜原因5');
    expect(text).toContain('6. 曝光不足｜端内ID 6｜曝光不足｜原因6');
    expect(text).not.toContain('曝光不足 Top5');
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
      '平台商品ID': 'P-1001',
      '端内ID': '端内ID 1001',
      '1日公域访问': 10,
      '1日创建订单': 2,
      '1日签约订单': 2,
      '1日审出订单': 1,
      '1日金额（元）': 88.5,
      '1日创建订单金额（元）': 120.5,
      '1日签约订单金额（元）': 99,
      '1日审出订单金额（元）': 88,
      '1日发货订单金额（元）': 77,
      '1日曝光→访问率': 0.1,
      '7日后链路访问': 56,
      '7日签约订单': 12,
      '7日审出订单': 9,
      '7日发货订单': 7,
      '7日访问→发货率': 0.125,
      '30日公域访问': 300,
      '30日创建订单': 60,
      '30日签约订单': 50,
      '30日审出订单': 40,
      '30日金额（元）': 2888.5,
    });
  });

  it('writes goods-manager new product pool IDs into workbook and Feishu text', () => {
    const withPool: PublicTrafficDataReportContext = { ...context, newProductPoolIds: ['701', '702'] };
    const workbook = XLSX.read(writePublicTrafficWorkbookBuffer(withPool), { type: 'buffer' });
    expect(workbook.SheetNames).toContain('新品池维护');
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['新品池维护']);
    expect(rows).toEqual([
      { 商品ID: '701', 维护状态: '待维护', 备注: '' },
      { 商品ID: '702', 维护状态: '待维护', 备注: '' },
    ]);

    const text = buildPublicTrafficFeishuText(withPool, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
    expect(text).toContain('新品池维护 2');
    expect(text).toContain('新品池维护');
    expect(text).toContain('1. 商品ID 701｜待维护');
  });

  it('falls back to new product pool IDs when enriched pool items are empty', () => {
    const withPool: PublicTrafficDataReportContext = { ...context, newProductPoolItems: [], newProductPoolIds: ['701', '702'] };

    const text = buildPublicTrafficFeishuText(withPool, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
    expect(text).toContain('新品池维护 2');
    expect(text).toContain('1. 商品ID 701｜待维护');

    const cardJson = JSON.stringify(buildPublicTrafficCard(withPool, { markdownPath: 'report.md', workbookPath: 'report.xlsx' }));
    expect(cardJson).toContain('新链接冷启动（2）');
    expect(cardJson).toContain('商品ID 701：待观察');
  });

  it('renders new link cold-start distribution and prioritized link details in Feishu card', () => {
    const row = (id: string, publicVisits: number, amount: number): PublicTrafficDataReportContext['rows'][number] => ({
      platformProductId: `P-${id}`,
      displayProductId: `端内ID ${id}`,
      productName: `新链接 ${id}`,
      custodyDays: 1,
      periods: {
        '1d': metrics({ publicVisits: Math.min(publicVisits, 10), amount: amount > 0 ? amount : 0 }),
        '7d': metrics({ publicVisits, amount }),
        '30d': metrics({ publicVisits, amount }),
      },
    });
    const withPool: PublicTrafficDataReportContext = {
      ...context,
      rows: [row('701', 0, 100), row('702', 25, 0), row('703', 14, 0), row('704', 8, 0), row('705', 2, 0), row('706', 0, 0)],
      newProductPoolItems: [
        { productId: '701', productName: '成交跑通链接', shortTitle: '', submittedAt: '2026-06-09 00:00:00', merchant: '', alipaySyncStatus: '', alipayCode: '', stock: 1, skuCount: 1, maintenanceStatus: '待维护', note: '' },
        { productId: '702', productName: '优秀访问链接', shortTitle: '', submittedAt: '2026-06-09 00:00:00', merchant: '', alipaySyncStatus: '', alipayCode: '', stock: 1, skuCount: 1, maintenanceStatus: '待维护', note: '' },
        { productId: '703', productName: '访问达标链接', shortTitle: '', submittedAt: '2026-06-09 00:00:00', merchant: '', alipaySyncStatus: '', alipayCode: '', stock: 1, skuCount: 1, maintenanceStatus: '待维护', note: '' },
        { productId: '704', productName: '有苗头链接', shortTitle: '', submittedAt: '2026-06-09 00:00:00', merchant: '', alipaySyncStatus: '', alipayCode: '', stock: 1, skuCount: 1, maintenanceStatus: '待维护', note: '' },
        { productId: '705', productName: '未启动链接', shortTitle: '', submittedAt: '2026-06-09 00:00:00', merchant: '', alipaySyncStatus: '', alipayCode: '', stock: 1, skuCount: 1, maintenanceStatus: '待维护', note: '' },
        { productId: '706', productName: '危险链接', shortTitle: '', submittedAt: '2026-06-06 00:00:00', merchant: '', alipaySyncStatus: '', alipayCode: '', stock: 1, skuCount: 1, maintenanceStatus: '待维护', note: '' },
        { productId: '707', productName: '未匹配链接', shortTitle: '', submittedAt: '2026-06-09 00:00:00', merchant: '', alipaySyncStatus: '', alipayCode: '', stock: 1, skuCount: 1, maintenanceStatus: '待维护', note: '' },
      ],
    };

    const cardJson = JSON.stringify(buildPublicTrafficCard(withPool, { markdownPath: 'report.md', workbookPath: 'report.xlsx' }));
    expect(cardJson).toContain('新链接冷启动（7）');
    expect(cardJson).toContain('近7天链接');
    expect(cardJson).toContain('优秀 1｜访问达标 1');
    expect(cardJson).toContain('认可线 >=6/天');
    expect(cardJson).toContain('优秀线 >=10/天');
    expect(cardJson).toContain('强跑通');
    expect(cardJson).toContain('优秀链接');
    expect(cardJson).toContain('访问达标');
    expect(cardJson).toContain('有苗头');
    expect(cardJson).toContain('未启动');
    expect(cardJson).toContain('危险');
    expect(cardJson).toContain('待观察');
    expect(cardJson).toContain('继续放量');
    expect(cardJson).toContain('优先重做');
    expect(cardJson).not.toContain('新品维护池（7）');

    const card = buildPublicTrafficCard(withPool, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
    const cardBody = card.body as { elements: Array<{ element_id?: string; elements?: Array<{ tag?: string }> }> };
    const panel = cardBody.elements.find((element) => element.element_id === 'new_product_pool');
    expect(panel?.elements?.some((element) => element.tag === 'table')).toBe(false);
  });

  it('marks links submitted after the report data date as waiting instead of dangerous', () => {
    const withPool: PublicTrafficDataReportContext = {
      ...context,
      date: '2026-06-10',
      rows: [
        {
          platformProductId: 'P-701',
          displayProductId: '端内ID 701',
          productName: '今日新同步链接',
          custodyDays: 0,
          periods: {
            '1d': metrics({ dashboardVisits: 0, shippedOrders: 0 }),
            '7d': metrics({ dashboardVisits: 0, shippedOrders: 0 }),
            '30d': metrics({ dashboardVisits: 0, shippedOrders: 0 }),
          },
        },
      ],
      newProductPoolItems: [
        { productId: '701', productName: '今日新同步链接', shortTitle: '', submittedAt: '2026-06-11 09:00:00', merchant: '', alipaySyncStatus: '已同步', alipayCode: '', stock: 0, skuCount: 0, maintenanceStatus: '待维护', note: '' },
      ],
    };

    const cardJson = JSON.stringify(buildPublicTrafficCard(withPool, { markdownPath: 'report.md', workbookPath: 'report.xlsx' }));
    expect(cardJson).toContain('待观察');
    expect(cardJson).not.toContain('危险 1');
    expect(cardJson).not.toContain('优先重做');
  });

  it('shows newer new-link pool items before older item IDs in the Feishu card', () => {
    const withPool: PublicTrafficDataReportContext = {
      ...context,
      date: '2026-06-12',
      rows: [],
      newProductPoolItems: [
        { productId: '703', productName: '较早链接', shortTitle: '', submittedAt: '2026-06-12 09:00:00', merchant: '', alipaySyncStatus: '已同步', alipayCode: '', stock: 0, skuCount: 0, maintenanceStatus: '待维护', note: '' },
        { productId: '900', productName: '最新链接', shortTitle: '', submittedAt: '2026-06-12 12:00:00', merchant: '', alipaySyncStatus: '已同步', alipayCode: '', stock: 0, skuCount: 0, maintenanceStatus: '待维护', note: '' },
      ],
    };

    const cardJson = JSON.stringify(buildPublicTrafficCard(withPool, { markdownPath: 'report.md', workbookPath: 'report.xlsx' }));
    expect(cardJson.indexOf('商品ID 900 最新链接')).toBeLessThan(cardJson.indexOf('商品ID 703 较早链接'));
  });

  it('renders enriched goods-manager new product pool summaries in Feishu text and card', () => {
    const longName = '超长商品名称用于验证卡片会做简短展示避免过宽';
    const withPool: PublicTrafficDataReportContext = {
      ...context,
      newProductPoolItems: Array.from({ length: 11 }, (_, index) => ({
        productId: String(701 + index),
        productName: index === 0 ? '新品 Alpha' : index === 10 ? '第十一个不展示' : longName,
        shortTitle: '',
        submittedAt: '2026-06-12 09:00:00',
        merchant: '',
        alipaySyncStatus: '',
        alipayCode: '',
        stock: 0,
        skuCount: 0,
        maintenanceStatus: '待维护',
        note: '',
      })),
    };

    const text = buildPublicTrafficFeishuText(withPool, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
    expect(text).toContain('新品池维护 11');
    expect(text).toContain('1. 商品ID 701 新品 Alpha：待维护');
    expect(text).toContain('10. 商品ID 710 超长商品名称用于验证卡片会做简短展示避免过宽：待维护');
    expect(text).not.toContain('第十一个不展示');

    const cardJson = JSON.stringify(buildPublicTrafficCard(withPool, { markdownPath: 'report.md', workbookPath: 'report.xlsx' }));
    expect(cardJson).toContain('新链接冷启动（11）');
    expect(cardJson).toContain('商品ID 701 新品 Alpha：待观察');
    expect(cardJson).toContain('商品ID 710 超长商品名称用于验证卡片会做简短展示...：待观察');
    expect(cardJson).not.toContain('第十一个不展示');
  });

  it('writes enriched goods-manager new product pool items into workbook maintenance sheet', () => {
    const withPool: PublicTrafficDataReportContext = {
      ...context,
      newProductPoolItems: [
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
      ],
    };

    const workbook = XLSX.read(writePublicTrafficWorkbookBuffer(withPool), { type: 'buffer' });
    expect(workbook.SheetNames).toContain('新品池维护');
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['新品池维护']);
    expect(Object.keys(rows[0])).toEqual(['商品ID', '商品名称', '短标题', '最近提交时间', '商家', '同步状态', '支付宝编码', '库存', 'SKU数', '维护状态', '备注']);
    expect(rows).toEqual([
      {
        商品ID: '701',
        商品名称: '新品 Alpha',
        短标题: 'Alpha 短标题',
        最近提交时间: '2026-06-12 09:00:00',
        商家: '主商家',
        同步状态: '已同步',
        支付宝编码: 'ALI-701',
        库存: 8,
        SKU数: 2,
        维护状态: '待维护',
        备注: '',
      },
    ]);
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

  it('商品明细表头为中文且含金额列', () => {
    const buffer = writePublicTrafficWorkbookBuffer(context);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets['商品明细'];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
    const headers = rows[0];
    expect(headers).toContain('平台商品ID');
    expect(headers).toContain('端内ID');
    expect(headers).toContain('商品名称');
    expect(headers).toContain('托管天数');
    expect(headers).toContain('1日曝光量');
    expect(headers).toContain('7日金额（元）');
    expect(headers).toContain('30日访问→发货率');
    expect(headers).toContain('1日创建订单金额（元）');
    expect(headers).toContain('7日签约订单金额（元）');
    expect(headers).toContain('30日发货订单金额（元）');
    expect(headers.some((h) => /^\d+d_/.test(String(h)))).toBe(false);
  });

  it('包含订单分析 sheet（context 带 orderAnalysis 时）', () => {
    const buffer = writePublicTrafficWorkbookBuffer(contextWithOrderAnalysis);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    expect(workbook.SheetNames).toContain('订单分析');
    const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets['订单分析'], { header: 1 });
    const flat = rows.map((row) => (row ?? []).join('|')).join('\n');
    expect(flat).toContain('【标准订单分析】数据日期：2026-06-10');
    expect(flat).toContain('签约订单数|103|较前日+32.1%');
    expect(flat).toContain('【归还分析】数据日期：未知');
    expect(flat).toContain('指标|数值|环比');
  });

  it('context 不带 orderAnalysis 时无订单分析 sheet', () => {
    const buffer = writePublicTrafficWorkbookBuffer(context);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    expect(workbook.SheetNames).not.toContain('订单分析');
  });

  it('卡片漏斗输出三行并省略冗余公域标题', () => {
    const card = buildPublicTrafficCard(contextWithOrderAnalysis, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
    const json = JSON.stringify(card);
    expect(json).not.toContain('今日漏斗');
    expect(json).toContain('公域（06-10）');
    expect(json).toContain('订单经营（06-10）');
    expect(json).toContain('发货率');
    expect(json).not.toContain('关单率');
    expect(json).not.toContain('客单价');
    expect(json).not.toContain('审出订单');
    expect(json).toContain('履约（发货06-10｜归还未知｜关单06-10）');
    expect(json).toContain('创建订单');
    expect(json).not.toContain('签约金额');
    expect(json).toContain('待发货');
    expect(json).toContain('关单');
  });

  it('卡片履约指标在同一行展示', () => {
    const card = buildPublicTrafficCard(contextWithOrderAnalysis, { markdownPath: 'report.md', workbookPath: 'report.xlsx' }) as { body: { elements: Array<Record<string, unknown>> } };
    const fulfillment = card.body.elements.find((element) => element.element_id === 'funnel_fulfillment') as { columns: Array<{ elements: Array<Record<string, unknown>> }> } | undefined;

    expect(fulfillment).toBeDefined();
    const metricRows = fulfillment!.columns[0].elements.filter((element) => element.tag === 'column_set') as Array<{ columns: Array<{ elements: Array<{ content?: string }> }> }>;
    expect(metricRows).toHaveLength(1);
    expect(metricRows[0].columns).toHaveLength(4);
    expect(metricRows[0].columns.map((column) => column.elements[0].content?.split('\n')[0])).toEqual(['待发货', '归还', '逾期', '关单']);
  });

  it('卡片关单率低于等于35%时显示达标', () => {
    const healthy = {
      ...contextWithOrderAnalysis,
      orderAnalysis: {
        ...contextWithOrderAnalysis.orderAnalysis!,
        pages: {
          ...contextWithOrderAnalysis.orderAnalysis!.pages,
          overview: {
            ...contextWithOrderAnalysis.orderAnalysis!.pages.overview,
            indicators: [
              { label: '创建订单数', value: '200', delta: '' },
              { label: '签约订单数', value: '100', delta: '' },
              { label: '发货订单数', value: '80', delta: '' },
              { label: '签约完成金额（元）', value: '4,000', delta: '' },
            ],
          },
          customs: { key: 'customs' as const, label: '关单分析', dataDate: '2026-06-10', indicators: [{ label: '关单数', value: '70', delta: '' }] },
        },
      },
    };

    const json = JSON.stringify(buildPublicTrafficCard(healthy, { markdownPath: 'report.md', workbookPath: 'report.xlsx' }));
    expect(json).toContain('发货率');
    expect(json).toContain('40.00%');
    expect(json).not.toContain('关单率');
  });

  it('无订单分析时卡片漏斗保持单行旧版', () => {
    const card = buildPublicTrafficCard(context, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
    const json = JSON.stringify(card);
    expect(json).not.toContain('履约（');
    expect(json).not.toContain('今日漏斗');
    expect(json).not.toContain('**公域**');
  });

  it('Markdown 1日总览输出三行', () => {
    const markdown = buildPublicTrafficMarkdown(contextWithOrderAnalysis);
    expect(markdown).toContain('公域（');
    expect(markdown).toContain('订单经营（06-10）：创建订单 194｜签约订单 103｜发货订单 64');
    expect(markdown).not.toContain('签约金额');
    expect(markdown).not.toContain('审出订单');
    expect(markdown).toContain('履约（发货06-10｜归还未知｜关单06-10）：待发货 168｜归还 15｜逾期 5｜关单 90');
    expect(markdown).toContain('经营指标：发货率 32.99%｜关单率 46.39%（目标<=35%，风险）｜客单价 ¥38.61');
  });

  it('renders fulfillment as rates', () => {
    const orderAnalysis = makeOrderAnalysisResult([
      { label: '创建订单数', value: '100', delta: '' },
      { label: '签约订单数', value: '50', delta: '' },
      { label: '审出订单数', value: '25', delta: '' },
      { label: '发货订单数', value: '10', delta: '' },
    ]);
    const reportContext = makeDataReportContext({ orderAnalysis });

    const cardJson = JSON.stringify(buildPublicTrafficCard(reportContext, { markdownPath: 'report.md', workbookPath: 'report.xlsx' }));

    expect(cardJson).toContain('发货率');
    expect(cardJson).not.toContain('审出/签约 50.00%');
    expect(cardJson).not.toContain('暂无昨日履约率对比');

    const markdown = buildPublicTrafficMarkdown(reportContext);
    expect(markdown).not.toContain('## 履约比率');
    expect(markdown).not.toContain('签约/创建 50.00%');
    expect(markdown).not.toContain('审出/签约 50.00%');
    expect(markdown).not.toContain('发货/审出 40.00%');
    expect(markdown).not.toContain('暂无昨日履约率对比');
  });

  it('renders fulfillment rates from comma and unit indicator values', () => {
    const orderAnalysis = makeOrderAnalysisResult([
      { label: '创建订单数', value: '1,000 单', delta: '' },
      { label: '签约订单数', value: '500单', delta: '' },
      { label: '审出订单数', value: '250', delta: '' },
      { label: '发货订单数', value: '0', delta: '' },
    ]);
    const reportContext = makeDataReportContext({ orderAnalysis });
    const cardJson = JSON.stringify(buildPublicTrafficCard(reportContext, { markdownPath: 'report.md', workbookPath: 'report.xlsx' }));
    const markdown = buildPublicTrafficMarkdown(reportContext);

    expect(cardJson).toContain('发货率');
    expect(cardJson).not.toContain('签约/创建 50.00%');
    expect(cardJson).not.toContain('发货/审出 0.00%');
    expect(markdown).not.toContain('签约/创建 50.00%');
    expect(markdown).not.toContain('发货/审出 0.00%');
  });

  it('renders missing fulfillment rates for zero and negative denominators', () => {
    const orderAnalysis = makeOrderAnalysisResult([
      { label: '创建订单数', value: '0', delta: '' },
      { label: '签约订单数', value: '-1', delta: '' },
      { label: '审出订单数', value: '10', delta: '' },
      { label: '发货订单数', value: '0', delta: '' },
    ]);
    const reportContext = makeDataReportContext({ orderAnalysis });
    const cardJson = JSON.stringify(buildPublicTrafficCard(reportContext, { markdownPath: 'report.md', workbookPath: 'report.xlsx' }));
    const markdown = buildPublicTrafficMarkdown(reportContext);

    expect(cardJson).toContain('发货率');
    expect(cardJson).not.toContain('签约/创建 -');
    expect(cardJson).not.toContain('审出/签约 -');
    expect(cardJson).not.toContain('发货/审出 0.00%');
    expect(markdown).not.toContain('签约/创建 -');
    expect(markdown).not.toContain('审出/签约 -');
    expect(markdown).not.toContain('发货/审出 0.00%');
  });

  it('renders missing fulfillment rates for non-numeric indicators', () => {
    const orderAnalysis = makeOrderAnalysisResult([
      { label: '创建订单数', value: '100', delta: '' },
      { label: '签约订单数', value: '暂无', delta: '' },
      { label: '审出订单数', value: '25', delta: '' },
      { label: '发货订单数', value: '10', delta: '' },
    ]);
    const reportContext = makeDataReportContext({ orderAnalysis });
    const cardJson = JSON.stringify(buildPublicTrafficCard(reportContext, { markdownPath: 'report.md', workbookPath: 'report.xlsx' }));
    const markdown = buildPublicTrafficMarkdown(reportContext);

    expect(cardJson).toContain('发货率');
    expect(cardJson).not.toContain('签约/创建 -');
    expect(markdown).not.toContain('签约/创建 -');
  });

  it('omits fulfillment rate section without order analysis', () => {
    const cardJson = JSON.stringify(buildPublicTrafficCard(context, { markdownPath: 'report.md', workbookPath: 'report.xlsx' }));
    const markdown = buildPublicTrafficMarkdown(context);

    expect(cardJson).not.toContain('履约比率');
    expect(markdown).not.toContain('## 履约比率');
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
