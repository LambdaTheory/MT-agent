import type { PublicTrafficMetricKey } from './publicTrafficMetricCatalog.js';
import type { AgentIntent } from './types.js';

type SameSkuBestIntent = Extract<AgentIntent, { type: 'best_product_by_same_sku' }>;

function cleanupRankingQuery(value: string): string | null {
  const query = value
    .replace(/[?？。!！]+$/g, '')
    .replace(/^(?:帮我|请|查一下|看下|看看)\s*/u, '')
    .replace(/\s*(?:是)?\s*(?:哪个|哪条|哪一个|哪款|什么)\s*(?:端内\s*id|id|链接)?\s*(?:是多少)?$/iu, '')
    .replace(/\s*(?:端内\s*id|id)\s*(?:是多少)?$/iu, '')
    .replace(/\s*的$/u, '')
    .trim();
  return query ? query : null;
}

function parsePeriodDays(text: string): number | undefined {
  const match = /近\s*(\d+)\s*天/u.exec(text);
  if (!match) return undefined;
  return Number(match[1]);
}

function parseRankingMetric(text: string): SameSkuBestIntent['metric'] | undefined {
  if (/金额|成交额|订单金额/u.test(text)) return 'amount';
  if (/曝光/u.test(text)) return 'exposure';
  if (/发货/u.test(text)) return 'shippedOrders';
  if (/近\s*\d+\s*天/u.test(text) && /数据/u.test(text)) return 'amount';
  return undefined;
}

function buildBestProductIntent(text: string, query: string | null): SameSkuBestIntent | null {
  if (!query) return null;
  const periodDays = parsePeriodDays(text);
  const metric = parseRankingMetric(text);
  return {
    type: 'best_product_by_same_sku',
    query,
    ...(periodDays ? { periodDays } : {}),
    ...(metric ? { metric } : {}),
  };
}

function parseBestProductBySameSkuQuery(text: string): SameSkuBestIntent | null {
  if (!/(数据|表现|同款|金额|成交额|曝光|发货)/u.test(text) || !/(最好|最佳|最优|最强)/u.test(text)) return null;

  const explicitInternalId = /端内\s*ID\s*(\d+)/iu.exec(text);
  if (explicitInternalId && /同款/u.test(text)) return buildBestProductIntent(text, explicitInternalId[1]!);

  const leadingPeriodBest = /^近\s*\d+\s*天\s*(?:数据|表现|金额|成交额|曝光|发货)?\s*(?:最好|最佳|最优|最强)的?\s*(.+?)\s*(?:是\s*)?(?:(?:哪个|哪条|哪一个|哪款|什么)\s*)?(?:端内\s*id|id|链接)?\s*(?:是多少)?$/iu.exec(text);
  if (leadingPeriodBest?.[1]) return buildBestProductIntent(text, cleanupRankingQuery(leadingPeriodBest[1]));

  const leadingBest = /^(?:数据|表现)\s*(?:最好|最佳|最优|最强)的?\s*(.+?)\s*(?:是\s*)?(?:(?:哪个|哪条|哪一个|哪款|什么)\s*)?(?:端内\s*id|id|链接)?\s*(?:是多少)?$/iu.exec(text);
  if (leadingBest?.[1]) return buildBestProductIntent(text, cleanupRankingQuery(leadingBest[1]));

  const trailingBestLink = /^(.+?)\s*(?:近\s*\d+\s*天\s*)?(?:金额|成交额|曝光|发货|数据|表现)\s*(?:最好|最佳|最优|最强)的?\s*链接\s*(?:是\s*)?(?:哪个|哪条|哪一个|哪款|什么)?$/iu.exec(text);
  if (trailingBestLink?.[1]) return buildBestProductIntent(text, cleanupRankingQuery(trailingBestLink[1]));

  const trailingBest = /^(.+?)\s*(?:近\s*\d+\s*天\s*)?(?:这个)?(?:同款组里|同款组中|同款里|同款中)?\s*(?:数据|表现|金额|成交额|曝光|发货)\s*(?:最好|最佳|最优|最强)的?(?:是)?\s*(?:(?:哪个|哪条|哪一个|哪款|什么)\s*)?(?:端内\s*id|id|链接)?\s*(?:是多少)?$/iu.exec(text);
  if (trailingBest?.[1]) return buildBestProductIntent(text, cleanupRankingQuery(trailingBest[1]));

  return null;
}

export function parseAgentDataIntent(input: string): AgentIntent {
  const text = input.replace(/\s+/g, ' ').trim();
  if (/^(今天|今日|最新).*(怎么样|概况|数据)/.test(text)) return { type: 'overview' };
  const refreshExplain = parseRefreshCandidateExplain(text);
  if (refreshExplain) return refreshExplain;
  const safeSource = parseSafeSourceIntent(text);
  if (safeSource) return safeSource;
  const bestProductIntent = parseBestProductBySameSkuQuery(text);
  if (bestProductIntent) return bestProductIntent;
  const product = /^(查询|商品|查)\s*(.+)$/.exec(text);
  if (product) return { type: 'product', keyword: product[2].trim() };
  if (/(要处理|任务|优先|不健康)/.test(text)) return { type: 'tasks' };
  if (/新品池|新品维护|新链接池|新链|冷启动链接/.test(text)) return { type: 'new_product_pool' };
  if (/失活|疑似失活|低活跃|活跃度低|长期弱表现|生命周期治理/.test(text)) return { type: 'inactive_links' };
  if (/下架链接|移除链接|消失链接|下架/.test(text)) return { type: 'removed_links' };
  if (/转化差|提转化|成交少/.test(text)) return { type: 'problem_products', problemType: 'weak_conversion' };
  if (/曝光低|补曝光/.test(text)) return { type: 'problem_products', problemType: 'low_exposure' };
  if (/高潜力|继续放量|可以继续放量/.test(text)) return { type: 'problem_products', problemType: 'high_potential' };
  if (/订单|发货|归还|关单|履约/.test(text)) return { type: 'order_summary' };
  return { type: 'unknown', text };
}

function parseRefreshCandidateExplain(text: string): AgentIntent | null {
  if (!/(为什么|为何|原因|解释)/u.test(text) || !/(候选|candidate)/iu.test(text)) return null;
  const metric = parseRefreshExplainMetric(text);
  if (!metric) return null;
  const condition = /(?:近\s*\d+\s*天)?\s*(?:访问量|公域访问量|曝光量|曝光|创建订单金额|创单金额|签约订单金额|签约金额|签单金额|审核订单金额|审核金额|审出金额|发货订单金额|发货金额|订单金额|交易金额|公域金额|金额)\s*(?:为|=)\s*0/u.exec(text);
  if (!condition) return null;
  const queryText = text.slice(0, condition.index).replace(/^(?:为什么|为何|原因|解释)\s*/u, '').trim();
  const query = cleanupRankingQuery(queryText);
  const windowDays = parsePeriodDays(text);
  return { type: 'refresh_candidate_explain', ...(query ? { query } : {}), metric, operator: 'eq', value: 0, ...(windowDays ? { windowDays } : {}) };
}

function parseRefreshExplainMetric(text: string): PublicTrafficMetricKey | null {
  const metricPatterns: Array<{ pattern: RegExp; metric: PublicTrafficMetricKey }> = [
    { pattern: /访问量|公域访问量/u, metric: 'publicVisits' },
    { pattern: /曝光量|曝光/u, metric: 'exposure' },
    { pattern: /创建订单金额|创单金额/u, metric: 'createdOrderAmount' },
    { pattern: /签约订单金额|签约金额|签单金额/u, metric: 'signedOrderAmount' },
    { pattern: /审核订单金额|审核金额|审出金额/u, metric: 'reviewedOrderAmount' },
    { pattern: /发货订单金额|发货金额/u, metric: 'shippedOrderAmount' },
    { pattern: /订单金额|交易金额|公域金额|金额/u, metric: 'amount' },
  ];
  return metricPatterns.find((item) => item.pattern.test(text))?.metric ?? null;
}

function parseSafeSourceIntent(text: string): AgentIntent | null {
  if (!/(安全源|源商品|补链源)/u.test(text)) return null;
  if (/(哪些|没有|缺少).*组/u.test(text) || /组.*(没有|缺少)/u.test(text)) return { type: 'safe_source_groups' };
  const queryMatch = /^(.+?)\s*(?:这个组|该组|这个同款组|该同款组|同款组|可不可以|能不能|可以|能|是否)/u.exec(text);
  const query = cleanupRankingQuery(queryMatch?.[1] ?? '');
  return { type: 'safe_source_resolve', ...(query ? { query } : {}) };
}
