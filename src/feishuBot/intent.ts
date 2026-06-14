import type { BotIntent, FeishuSendTo } from './types.js';

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function sendTo(text: string): FeishuSendTo | undefined {
  if (/发全部|发两边|both/i.test(text)) return 'both';
  if (/发群|群里|group/i.test(text)) return 'group';
  if (/发我|个人|personal/i.test(text)) return 'personal';
  return undefined;
}

export function parseBotIntent(input: string): BotIntent {
  const text = normalize(input);
  if (!text) return { type: 'help' };
  if (/^(帮助|help|\/help)$/i.test(text)) return { type: 'help' };
  if (/^(跑|生成|执行).*(公域)?日报/.test(text)) return { type: 'run_public_traffic_report', sendTo: sendTo(text) };
  if (/^推送(日报|公域日报)到群$/.test(text)) return { type: 'push_latest_report_to_group' };
  if (/^重发.*(公域)?日报/.test(text)) return { type: 'resend_latest_report', sendTo: sendTo(text) };
  if (/^(今日|今天|最新).*(概况|数据|日报)?$/.test(text)) return { type: 'latest_summary' };

  const query = /^(查询|商品)\s+(.+)$/.exec(text);
  if (query) return { type: 'query_product', keyword: query[2].trim() };

  return { type: 'unknown', text };
}
