import { describe, expect, it } from 'vitest';
import { buildOperationsLearningQuestionCard, buildOperationsLearningQuizCard, buildOperationsLearningQuizMarkdown, selectOperationsLearningQuizItems } from '../src/operationsLearningLoop/quiz.js';
import type { PublicTrafficDataReportContext, PublicTrafficPeriodMetrics } from '../src/publicTraffic/types.js';

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

function row(id: number, overrides: Partial<PublicTrafficPeriodMetrics> = {}) {
  const one = metrics({ exposure: 100 + id, publicVisits: 10 + id, dashboardVisits: 8 + id, shippedOrders: id % 3, amount: id * 10, exposureVisitRate: 0.1, visitShipmentRate: 0.02, ...overrides });
  const seven = metrics({ exposure: 700 + id, publicVisits: 70 + id, dashboardVisits: 56 + id, shippedOrders: id % 5, amount: id * 50, exposureVisitRate: 0.1, visitShipmentRate: 0.03 });
  const thirty = metrics({ exposure: 3000 + id, publicVisits: 300 + id, dashboardVisits: 240 + id, shippedOrders: id % 7, amount: id * 100, exposureVisitRate: 0.1, visitShipmentRate: 0.04 });
  return { productName: `测试商品${id}`, platformProductId: `p${id}`, displayProductId: `端内ID ${id}`, custodyDays: id, periods: { '1d': one, '7d': seven, '30d': thirty } };
}

const rows = Array.from({ length: 12 }, (_, index) => row(701 + index));

const context: PublicTrafficDataReportContext = {
  date: '2026-06-15',
  summary: {
    '1d': { exposure: 1000, publicVisits: 50, dashboardVisits: 40, createdOrders: 4, shippedOrders: 2, amount: 300, exposureVisitRate: 0.05, visitCreatedOrderRate: 0.1, visitShipmentRate: 0.05 },
    '7d': { exposure: 7000, publicVisits: 350, dashboardVisits: 280, createdOrders: 20, shippedOrders: 10, amount: 1500, exposureVisitRate: 0.05, visitCreatedOrderRate: 0.0714, visitShipmentRate: 0.0357 },
    '30d': { exposure: 30000, publicVisits: 1500, dashboardVisits: 1200, createdOrders: 80, shippedOrders: 40, amount: 6000, exposureVisitRate: 0.05, visitCreatedOrderRate: 0.0667, visitShipmentRate: 0.0333 },
  },
  conclusions: [],
  dataQualityNotes: [],
  rows,
  lowExposure: rows.slice(0, 4).map((item) => ({ identifier: item.displayProductId, action: '补曝光', reason: '曝光不足' })),
  weakClick: [],
  weakConversion: rows.slice(2, 7).map((item) => ({ identifier: item.displayProductId, action: '提转化', reason: '访问有发货弱' })),
  highPotential: rows.slice(5, 10).map((item) => ({ identifier: item.displayProductId, action: '继续放量', reason: '高潜力' })),
  newProductObservation: rows.slice(8, 12).map((item) => ({ identifier: item.displayProductId, action: '新品监控', reason: '新进入公域' })),
  lifecycleGovernance: [],
  recommendedActions: rows.slice(1, 11).map((item, index) => ({ identifier: item.displayProductId, action: '检查运营动作', reason: '建议操作池', priority: index < 3 ? 'high' : index < 7 ? 'medium' : 'low' })),
  newProductPoolItems: rows.slice(9, 12).map((item) => ({ productId: item.displayProductId.replace(/^端内ID\s*/, ''), productName: item.productName, shortTitle: '', submittedAt: '2026-06-15 09:00:00', merchant: '', alipaySyncStatus: '已同步', alipayCode: '', stock: 0, skuCount: 0, maintenanceStatus: '待维护', note: '' })),
  agentData: { removedLinks: [] },
  emptySectionNotes: { lowExposure: '', weakClick: '', weakConversion: '', highPotential: '', newProductObservation: '', lifecycleGovernance: '', recommendedActions: '' },
};

describe('operations learning loop quiz preview', () => {
  it('selects ten representative quiz items with details and feedback choices', () => {
    const items = selectOperationsLearningQuizItems(context, 10, { '702': '短名 702' });

    expect(items).toHaveLength(10);
    expect(new Set(items.map((item) => item.productId)).size).toBe(10);
    expect(items.map((item) => item.productId)).toContain('702');
    expect(items.find((item) => item.productId === '702')?.productName).toBe('短名 702');
    expect(items.find((item) => item.productId === '703')?.sourceModules).toEqual(['建议操作']);
    expect(items[0]).toMatchObject({ productId: expect.any(String), productName: expect.any(String), recommendedOperation: expect.any(String) });
    expect(items[0].metrics['1d']).toMatchObject({ exposure: expect.any(Number), publicVisits: expect.any(Number), shippedOrders: expect.any(Number) });
    expect(items[0].feedbackOptions).toContain('not_representative');
  });

  it('renders markdown and card preview without sending Feishu messages', () => {
    const items = selectOperationsLearningQuizItems(context);
    const markdown = buildOperationsLearningQuizMarkdown(context.date, items);
    const card = buildOperationsLearningQuizCard(context.date, items);

    expect(markdown).toContain('运营学习 loop 测验');
    expect(markdown).toContain('端内ID 702');
    expect(markdown).toContain('反馈选项');
    expect(card.header.title.content).toBe('运营学习 loop 测验');
    expect(JSON.stringify(card)).toContain('not_representative');
    expect(JSON.stringify(card)).not.toContain('FEISHU');
  });

  it('renders a single-question interactive card with feedback buttons and suggestion input', () => {
    const [item] = selectOperationsLearningQuizItems(context);
    const card = buildOperationsLearningQuestionCard(context.date, item, { index: 1, total: 10 });
    const serialized = JSON.stringify(card);

    expect(card.header.title.content).toBe('运营学习 loop 测验 1/10');
    expect(card.schema).toBe('2.0');
    expect(JSON.stringify(card)).toContain('tag":"form');
    expect(serialized).toContain('tag":"input');
    expect(serialized).toContain('name":"suggested_action');
    expect(serialized).toContain('input_type":"text');
    expect(serialized).toContain('action_type":"form_submit');
    expect(serialized).toContain('behaviors');
    expect(serialized).toContain('tag":"button');
    expect(serialized).toContain('tag":"column_set');
    expect(serialized).toContain('operations_learning_period_metric_matrix');
    expect(serialized).not.toContain('tag":"table');
    expect(serialized).not.toContain('tag":"collapsible_panel');
    expect(serialized).toContain('tag":"note');
    expect(serialized).toContain('tag":"hr');
    expect(serialized).toContain('background_style":"grey');
    expect(serialized).toContain('color=\'orange\'');
    expect(serialized).not.toContain('来源模块');
    expect(serialized).toContain('Agent 建议操作');
    expect(serialized).toContain('1 / 7 / 30 日详细数据');
    expect(serialized).toContain('1 日');
    expect(serialized).toContain('7 日');
    expect(serialized).toContain('30 日');
    expect(serialized).toContain('曝光');
    expect(serialized).toContain('公域访问');
    expect(serialized).toContain('商品页访问');
    expect(serialized).toContain('创建单');
    expect(serialized).toContain('发货');
    expect(serialized).toContain('金额');
    expect(serialized).toContain('曝光到访问');
    expect(serialized).toContain('访问到发货');
    expect(serialized).toContain('feedback":"reasonable');
    expect(serialized).toContain('feedback":"unreasonable');
    expect(serialized).toContain('feedback":"suggested_action');
    expect(serialized).toContain('feedback":"not_representative');
    expect(serialized).toContain(item.productId);
  });

});
