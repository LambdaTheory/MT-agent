import type { AgentIntent } from './types.js';

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

function parseBestProductBySameSkuQuery(text: string): string | null {
  if (!/(数据|表现|同款)/u.test(text) || !/(最好|最佳|最优|最强)/u.test(text)) return null;

  const explicitInternalId = /端内\s*ID\s*(\d+)/iu.exec(text);
  if (explicitInternalId && /同款/u.test(text)) return explicitInternalId[1]!;

  const leadingBest = /^(?:数据|表现)\s*(?:最好|最佳|最优|最强)的?\s*(.+?)\s*(?:是\s*)?(?:(?:哪个|哪条|哪一个|哪款|什么)\s*)?(?:端内\s*id|id|链接)?\s*(?:是多少)?$/iu.exec(text);
  if (leadingBest?.[1]) return cleanupRankingQuery(leadingBest[1]);

  const trailingBest = /^(.+?)\s*(?:这个)?(?:同款组里|同款组中|同款里|同款中)?\s*(?:数据|表现)\s*(?:最好|最佳|最优|最强)(?:的是|是)?\s*(?:(?:哪个|哪条|哪一个|哪款|什么)\s*)?(?:端内\s*id|id|链接)?\s*(?:是多少)?$/iu.exec(text);
  if (trailingBest?.[1]) return cleanupRankingQuery(trailingBest[1]);

  return null;
}

export function parseAgentDataIntent(input: string): AgentIntent {
  const text = input.replace(/\s+/g, ' ').trim();
  if (/^(今天|今日|最新).*(怎么样|概况|数据)/.test(text)) return { type: 'overview' };
  const bestProductQuery = parseBestProductBySameSkuQuery(text);
  if (bestProductQuery) return { type: 'best_product_by_same_sku', query: bestProductQuery };
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
