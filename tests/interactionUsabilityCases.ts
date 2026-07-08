export const usabilityFailureLayers = [
  'capability',
  'metadata',
  'routing',
  'workflow',
  'data_health',
  'reply_channel',
] as const;

export type UsabilityFailureLayer = typeof usabilityFailureLayers[number];

export type InteractionCategory = 'query' | 'window' | 'strategy' | 'plan' | 'execute' | 'multistep';

export type InteractionResponseType = 'text' | 'clarification_card' | 'strategy_card' | 'execute_confirm_card' | 'none';

export interface CapabilityExpectation {
  description: string;
  toolName: string;
  arguments?: Record<string, unknown>;
}

export interface InteractionCase {
  id: string;
  category: InteractionCategory;
  utterance: string;
  capabilityExpectation: CapabilityExpectation;
  expectedFailureLayer: UsabilityFailureLayer;
  expectedResponseType: InteractionResponseType;
  notes?: string;
}

export const interactionUsabilityCases: InteractionCase[] = [
  {
    id: 'query-status-956',
    category: 'query',
    utterance: '查956',
    capabilityExpectation: { description: '查询单个端内ID状态', toolName: 'product.query', arguments: { keyword: '956' } },
    expectedFailureLayer: 'routing',
    expectedResponseType: 'text',
  },
  {
    id: 'best-r50-20d',
    category: 'query',
    utterance: '近20天数据最好r50是哪个id',
    capabilityExpectation: { description: '按同款组找近20天金额最佳链接', toolName: 'product.rankBestSameSku', arguments: { query: 'r50', periodDays: 20, metric: 'amount' } },
    expectedFailureLayer: 'routing',
    expectedResponseType: 'text',
  },
  {
    id: 'daily-summary',
    category: 'query',
    utterance: '日报概况',
    capabilityExpectation: { description: '查询日报概况', toolName: 'publicTraffic.reportQuery', arguments: { target: 'summary' } },
    expectedFailureLayer: 'routing',
    expectedResponseType: 'text',
  },
  {
    id: 'zero-exposure-15d',
    category: 'window',
    utterance: '近15天曝光为0的有哪些?',
    capabilityExpectation: { description: '聚合近15天窗口曝光数据', toolName: 'publicTraffic.windowAggregate', arguments: { endDate: '2026-07-02', windowDays: 15 } },
    expectedFailureLayer: 'routing',
    expectedResponseType: 'text',
  },
  {
    id: 'zero-amount-20d',
    category: 'window',
    utterance: '近20天金额为0的有哪些?',
    capabilityExpectation: { description: '聚合近20天窗口金额数据', toolName: 'publicTraffic.windowAggregate', arguments: { endDate: '2026-07-02', windowDays: 20 } },
    expectedFailureLayer: 'routing',
    expectedResponseType: 'text',
  },
  {
    id: 'zero-orders-30d',
    category: 'window',
    utterance: '近30天订单为0的有哪些?',
    capabilityExpectation: { description: '聚合近30天窗口订单数据', toolName: 'publicTraffic.windowAggregate', arguments: { endDate: '2026-07-02', windowDays: 30 } },
    expectedFailureLayer: 'routing',
    expectedResponseType: 'text',
  },
  {
    id: 'why-zero-candidates',
    category: 'strategy',
    utterance: '为什么R50一个候选都没有',
    capabilityExpectation: { description: '解释活跃度刷新候选筛选结果', toolName: 'strategy.refreshCandidateExplain', arguments: { query: 'r50', zeroMetric: 'amount' } },
    expectedFailureLayer: 'routing',
    expectedResponseType: 'text',
  },
  {
    id: 'can-refill-same-sku',
    category: 'strategy',
    utterance: '这个同款组能不能补链',
    capabilityExpectation: { description: '解析同款组安全补链源', toolName: 'strategy.safeSourceResolve', arguments: { sameSkuGroupId: 'canon-eos-r50', excludedProductIds: ['681'] } },
    expectedFailureLayer: 'metadata',
    expectedResponseType: 'clarification_card',
  },
  {
    id: 'who-is-safe-source',
    category: 'strategy',
    utterance: '安全源是谁',
    capabilityExpectation: { description: '解析同款组安全源商品', toolName: 'strategy.safeSourceResolve', arguments: { sameSkuGroupId: 'canon-eos-r50', excludedProductIds: ['681'] } },
    expectedFailureLayer: 'metadata',
    expectedResponseType: 'clarification_card',
  },
  {
    id: 'refresh-r50-zero-amount',
    category: 'plan',
    utterance: '帮我下架r50近30天产生订单金额为0的链接',
    capabilityExpectation: { description: '生成 R50 定向活跃度刷新计划', toolName: 'operations.refreshActivityPlan', arguments: { query: 'r50', zeroMetric: 'amount' } },
    expectedFailureLayer: 'routing',
    expectedResponseType: 'strategy_card',
  },
  {
    id: 'refresh-pocket3-zero-amount',
    category: 'plan',
    utterance: '帮我下架pocket3近30天产生订单金额为0的链接',
    capabilityExpectation: { description: '生成 Pocket 3 定向活跃度刷新计划', toolName: 'operations.refreshActivityPlan', arguments: { query: 'pocket3', zeroMetric: 'amount' } },
    expectedFailureLayer: 'routing',
    expectedResponseType: 'strategy_card',
  },
  {
    id: 'global-refresh-plan',
    category: 'plan',
    utterance: '帮我下架近30天产生订单金额为0的链接',
    capabilityExpectation: { description: '生成全局活跃度刷新计划', toolName: 'operations.refreshActivityPlan', arguments: { zeroMetric: 'amount' } },
    expectedFailureLayer: 'workflow',
    expectedResponseType: 'strategy_card',
  },
  {
    id: 'execute-delist-only',
    category: 'execute',
    utterance: '只下架近30天产生订单金额为0的链接',
    capabilityExpectation: { description: '生成只下架策略的刷新计划确认入口', toolName: 'operations.refreshActivityPlan', arguments: { zeroMetric: 'amount' } },
    expectedFailureLayer: 'workflow',
    expectedResponseType: 'strategy_card',
  },
  {
    id: 'execute-delist-and-refill',
    category: 'execute',
    utterance: '帮我下架所有近30天产生订单金额为0的链接,除了没有可用的安全源商品,并且下掉一个补链一个',
    capabilityExpectation: { description: '生成下架加补链策略的刷新计划确认入口', toolName: 'operations.refreshActivityPlan', arguments: { zeroMetric: 'amount' } },
    expectedFailureLayer: 'workflow',
    expectedResponseType: 'strategy_card',
  },
  {
    id: 'lookup-then-copy',
    category: 'multistep',
    utterance: '先查一下2026013022000994654214的端内id是多少,然后根据这个id铺四条链接',
    capabilityExpectation: { description: '先做商品ID互查再生成铺链计划', toolName: 'linkRegistry.resolveProducts', arguments: { query: '2026013022000994654214' } },
    expectedFailureLayer: 'metadata',
    expectedResponseType: 'execute_confirm_card',
  },
  {
    id: 'window-then-delist-refill',
    category: 'multistep',
    utterance: '近15天曝光为0的有哪些?下架,并且补链这些id',
    capabilityExpectation: { description: '先聚合窗口曝光再进入刷新计划', toolName: 'publicTraffic.windowAggregate', arguments: { endDate: '2026-07-02', windowDays: 15 } },
    expectedFailureLayer: 'metadata',
    expectedResponseType: 'execute_confirm_card',
  },
];
