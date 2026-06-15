import type { AgentIntent } from './types.js';

export function parseAgentDataIntent(input: string): AgentIntent {
  const text = input.replace(/\s+/g, ' ').trim();
  if (/^(今天|今日|最新).*(怎么样|概况|数据)/.test(text)) return { type: 'overview' };
  const product = /^(查询|商品|查)\s*(.+)$/.exec(text);
  if (product) return { type: 'product', keyword: product[2].trim() };
  if (/(要处理|任务|优先|不健康)/.test(text)) return { type: 'tasks' };
  if (/新品池|新品维护|新链接池|新链|冷启动链接/.test(text)) return { type: 'new_product_pool' };
  if (/下架链接|移除链接|消失链接|下架/.test(text)) return { type: 'removed_links' };
  if (/转化差|提转化|成交少/.test(text)) return { type: 'problem_products', problemType: 'weak_conversion' };
  if (/曝光低|补曝光/.test(text)) return { type: 'problem_products', problemType: 'low_exposure' };
  if (/高潜力|继续放量|可以继续放量/.test(text)) return { type: 'problem_products', problemType: 'high_potential' };
  if (/订单|发货|归还|关单|履约/.test(text)) return { type: 'order_summary' };
  return { type: 'unknown', text };
}
