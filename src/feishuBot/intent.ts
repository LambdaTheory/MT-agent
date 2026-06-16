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
  if (/(今日|今天|现在|公域).*(咋样|怎么样|概况|数据|日报|看下|看看)/.test(text) || /日报/.test(text)) return { type: 'latest_summary' };
  if (/^(运营学习|学习测验|今日测验|loop测验|运营测验|测验)$|学习\s*loop|运营学习\s*loop/i.test(text)) return { type: 'operations_learning_quiz' };
  if (/^(?:商品)?ID(?:查询|互查|转换|换算)$|^打开(?:商品)?ID(?:查询|互查|转换|换算)$|^查ID$/i.test(text)) return { type: 'lookup_product_id_card' };

  const idLookup = /^(?:查ID|ID查询)\s*(\d+)$/.exec(text)
    ?? /^(端内(?:ID)?\s*\d+)(?:对应平台|的平台ID)?$/.exec(text)
    ?? /^(平台(?:商品)?ID\s*(?:转端内\s*)?\d+)$/.exec(text)
    ?? /^(\d+)\s*的平台ID$/.exec(text)
    ?? /^(20\d{18,})\s*的端内ID$/.exec(text);
  if (idLookup) return { type: 'lookup_product_id', query: idLookup[1].trim() };

  const query = /^(?:查询商品|查商品|查询|商品)\s+(.+)$/.exec(text)
    ?? /^这个商品\s+(.+?)\s*(?:数据如何|怎么样|如何)?$/.exec(text);
  if (query) return { type: 'query_product', keyword: query[1].trim() };

  return { type: 'unknown', text };
}
