import { describe, expect, it } from 'vitest';
import { FakeLlmProvider } from '../src/llm/fakeProvider.js';
import { createLlmToolSelector } from '../src/feishuBot/llmToolSelector.js';
import { findReadOnlyToolByLlmName } from '../src/feishuBot/readOnlyToolRegistry.js';
import { runReadOnlyToolSelection } from '../src/feishuBot/llmReadOnlyToolAdapter.js';
import { parseLlmToolSelection, type LlmToolSelection } from '../src/feishuBot/llmProvider.js';
import { createLinkRegistry } from '../src/linkRegistry/store.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';
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
  lifecycleGovernance: [{ identifier: '端内ID 706', action: '下架、替换或重做素材', reason: '已托管 45 天，30日曝光 60，访问 1，金额 0.00' }],
  recommendedActions: [],
  newProductPoolItems: [{ productId: '701', productName: '大疆 Pocket 3', shortTitle: '', submittedAt: '2026-06-15 09:00:00', merchant: '', alipaySyncStatus: '已同步', alipayCode: '', stock: 0, skuCount: 0, maintenanceStatus: '待维护', note: '' }],
  agentData: { removedLinks: [] },
  orderAnalysis: { runDate: '2026-06-15', pages: { overview: { label: '订单概览', dataDate: '2026-06-14', indicators: [{ label: '发货订单', value: '12' }] } } },
  emptySectionNotes: { lowExposure: '', weakClick: '', weakConversion: '', highPotential: '', newProductObservation: '', lifecycleGovernance: '', recommendedActions: '' },
} as unknown as PublicTrafficDataReportContext;

const rankingContext = {
  ...context,
  rows: [
    ...context.rows,
    {
      productName: '大疆 Pocket 3 高转化套装',
      platformProductId: 'p702',
      displayProductId: '端内ID 702',
      custodyDays: 2,
      periods: {
        '1d': { ...metric, shippedOrders: 1, amount: 188, publicVisits: 22 },
        '7d': { ...metric, shippedOrders: 4, amount: 888, publicVisits: 80 },
        '30d': metric,
      },
    },
  ],
} as unknown as PublicTrafficDataReportContext;

const registry: LinkRegistryEntry[] = [
  { internalProductId: '701', platformProductId: 'p701', shortName: 'DJI Pocket 3', sameSkuGroupId: 'dji-pocket-3', status: 'active', source: ['product_name_map'] },
  { internalProductId: '702', platformProductId: 'p702', shortName: 'DJI Pocket 3', sameSkuGroupId: 'dji-pocket-3', status: 'active', source: ['product_name_map'] },
];

function selection(tool: LlmToolSelection['tool'], selectionArguments: Record<string, unknown>): LlmToolSelection {
  return { intent: 'test', tool, arguments: selectionArguments, confidence: 0.9, reason: 'test' };
}

async function selectReadOnlyToolForTest(message: string): Promise<LlmToolSelection | null> {
  const provider = new FakeLlmProvider('{"intent":"rank_best","tool":"rank_best_same_sku_product","arguments":{"query":"链接","metric":"publicVisits","periodDays":15},"confidence":0.92,"reason":"legacy ranking"}');
  const selector = createLlmToolSelector(provider);
  const parsed = parseLlmToolSelection(await selector.selectTool({ message }));

  return parsed.ok && parsed.selection.tool !== 'none' ? parsed.selection : null;
}

async function runLegacyReadOnlyToolForTest(message: string): Promise<{ text: string }> {
  const provider = new FakeLlmProvider('{"intent":"rank_best","tool":"rank_best_same_sku_product","arguments":{"query":"链接","metric":"signedOrderAmount","periodDays":15},"confidence":0.92,"reason":"legacy ranking"}');
  const selector = createLlmToolSelector(provider);
  const parsed = parseLlmToolSelection(await selector.selectTool({ message }));
  if (!parsed.ok || parsed.selection.tool === 'none') return { text: parsed.ok ? parsed.selection.reason : '请使用数据查询工具处理该问题。' };

  const result = await runReadOnlyToolSelection(context, parsed.selection);
  return result.ok ? result.response : { text: '请使用数据查询工具处理该问题。' };
}

describe('LLM read-only tool adapter', () => {
  it('routes arbitrary-window metric requests to publicTraffic.windowQuery, not legacy read-only tools', async () => {
    const selected = await selectReadOnlyToolForTest('访问量15天内为0的链接');

    expect(selected).toBeNull();
  });

  it('keeps legacy selector from rewriting a metric it cannot represent', async () => {
    const response = await runLegacyReadOnlyToolForTest('近15天签约订单金额为0的链接');

    expect(response.text).toContain('请使用数据查询工具');
    expect(response.text).not.toContain('金额为0');
    expect(response.text).not.toContain('创单为0');
  });

  it('runs a registry-backed product query from an LLM selection', async () => {
    const result = await runReadOnlyToolSelection(context, selection('query_product_performance', { keyword: '701' }));

    expect(result).toMatchObject({ ok: true, intent: { type: 'product', keyword: '701' } });
    if (result.ok) expect(result.response.text).toContain('端内ID 701');
  });

  it('rejects a product selection without a keyword before running a tool', async () => {
    await expect(runReadOnlyToolSelection(context, selection('query_product_performance', {}))).resolves.toEqual({ ok: false, reason: 'invalid_arguments' });
  });

  it('runs a best same-sku ranking selection with registry data', async () => {
    const result = await runReadOnlyToolSelection(
      rankingContext,
      selection('rank_best_same_sku_product', { query: 'Pocket3' }),
      { linkRegistryStore: createLinkRegistry(registry) },
    );

    expect(result).toMatchObject({ ok: true, intent: { type: 'best_product_by_same_sku', query: 'Pocket3' } });
    if (result.ok) expect(result.response.text).toContain('端内ID 702');
  });

  it('runs an inactive-link candidate selection from lifecycle governance', async () => {
    const result = await runReadOnlyToolSelection(context, selection('get_inactive_links', {}));

    expect(result).toMatchObject({ ok: true, intent: { type: 'inactive_links' } });
    if (result.ok) expect(result.response.text).toContain('失活候选链接ID集合：706');
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
    expect(provider.lastInput?.messages.at(-1)?.content).toContain('rank_best_same_sku_product');
    expect(provider.lastInput?.messages.at(-1)?.content).not.toContain('run_public_traffic_report');
    expect(provider.lastInput?.messages.at(-1)?.content).not.toContain('get_supported_questions');
  });
});
