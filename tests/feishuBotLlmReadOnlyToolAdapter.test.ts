import { describe, expect, it } from 'vitest';
import { FakeLlmProvider } from '../src/llm/fakeProvider.js';
import { createLlmToolSelector } from '../src/feishuBot/llmToolSelector.js';
import { findReadOnlyToolByLlmName } from '../src/feishuBot/readOnlyToolRegistry.js';
import { runReadOnlyToolSelection } from '../src/feishuBot/llmReadOnlyToolAdapter.js';
import type { LlmToolSelection } from '../src/feishuBot/llmProvider.js';
import type { PublicTrafficDataReportContext } from '../src/publicTraffic/types.js';

const metric = {
  exposure: 100,
  publicVisits: 10,
  dashboardVisits: 8,
  createdOrders: 2,
  signedOrders: 0,
  reviewedOrders: 0,
  shippedOrders: 1,
  amount: 88,
  exposureVisitRate: 0.1,
  visitCreatedOrderRate: 0.2,
  visitShipmentRate: 0.1,
  hasExposureData: true,
  hasDashboardData: true,
};

const context = {
  date: '2026-06-15',
  summary: { '1d': metric, '7d': metric, '30d': metric },
  conclusions: [],
  dataQualityNotes: [],
  rows: [{ productName: '大疆 Pocket 3', platformProductId: 'p701', displayProductId: '端内ID 701', custodyDays: 3, periods: { '1d': metric, '7d': metric, '30d': metric } }],
  lowExposure: [],
  weakClick: [],
  weakConversion: [{ identifier: '端内ID 701', action: '提转化', reason: '访问多成交少' }],
  highPotential: [],
  newProductObservation: [],
  lifecycleGovernance: [],
  recommendedActions: [],
  newProductPoolItems: [{ productId: '701', productName: '大疆 Pocket 3', shortTitle: '', submittedAt: '2026-06-15 09:00:00', merchant: '', alipaySyncStatus: '已同步', alipayCode: '', stock: 0, skuCount: 0, maintenanceStatus: '待维护', note: '' }],
  agentData: { removedLinks: [] },
  orderAnalysis: { runDate: '2026-06-15', pages: { overview: { label: '订单概览', dataDate: '2026-06-14', indicators: [{ label: '发货订单', value: '12' }] } } },
  emptySectionNotes: { lowExposure: '', weakClick: '', weakConversion: '', highPotential: '', newProductObservation: '', lifecycleGovernance: '', recommendedActions: '' },
} as unknown as PublicTrafficDataReportContext;

function selection(tool: LlmToolSelection['tool'], selectionArguments: Record<string, unknown>): LlmToolSelection {
  return { intent: 'test', tool, arguments: selectionArguments, confidence: 0.9, reason: 'test' };
}

describe('LLM read-only tool adapter', () => {
  it('runs a registry-backed product query from an LLM selection', async () => {
    const result = await runReadOnlyToolSelection(context, selection('query_product_performance', { keyword: '701' }));

    expect(result).toMatchObject({ ok: true, intent: { type: 'product', keyword: '701' } });
    if (result.ok) expect(result.response.text).toContain('端内ID 701');
  });

  it('rejects a product selection without a keyword before running a tool', async () => {
    await expect(runReadOnlyToolSelection(context, selection('query_product_performance', {}))).resolves.toEqual({ ok: false, reason: 'invalid_arguments' });
  });

  it('does not resolve unsupported LLM tools to registry tools', async () => {
    expect(findReadOnlyToolByLlmName('none')).toBeUndefined();
    expect(findReadOnlyToolByLlmName('get_supported_questions')).toBeUndefined();
    await expect(runReadOnlyToolSelection(context, selection('none', {}))).resolves.toEqual({ ok: false, reason: 'unsupported_tool' });
  });

  it('creates a selector that exposes only registry-backed read-only tools', async () => {
    const provider = new FakeLlmProvider('{"intent":"summary","tool":"get_latest_summary","arguments":{},"confidence":0.9,"reason":"summary"}');
    const selector = createLlmToolSelector(provider);

    await expect(selector.selectTool({ message: '今日概况' })).resolves.toContain('get_latest_summary');
    expect(provider.lastInput?.messages.at(-1)?.content).toContain('get_latest_summary');
    expect(provider.lastInput?.messages.at(-1)?.content).not.toContain('run_public_traffic_report');
    expect(provider.lastInput?.messages.at(-1)?.content).not.toContain('get_supported_questions');
  });
});
