import type { BotIntent, FeishuSendTo } from './types.js';
import {
  parseDelistCommand,
  parseRentalCopyCommand,
  parseRentalPriceChange,
  parseSpecAddCommand,
  parseSpecDiscoverCommand,
  parseTenancySetCommand,
} from './rentalPrice.js';
import { resolveSemanticAlias } from './semanticAlias.js';

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function sendTo(text: string): FeishuSendTo | undefined {
  if (/(发全部|发两边|both)/i.test(text)) return 'both';
  if (/(发群|群里|group)/i.test(text)) return 'group';
  if (/(发我|个人|personal)/i.test(text)) return 'personal';
  return undefined;
}

function looksLikeNewLinkWriteIntent(text: string): boolean {
  const compact = text.toLowerCase().replace(/\s+/g, '');
  return /(新链|新链接)/.test(compact) && /(链|铺设|新建|创建|生成|新增|复制|批量)/.test(compact);
}

export function parseExactBotIntent(input: string): BotIntent {
  const text = normalize(input);
  if (!text) return { type: 'help' };
  if (/^(帮助|help|\/help)$/i.test(text)) return { type: 'help' };
  if (/^(跑|生成|执行).*(公域)?日报/.test(text)) return { type: 'run_public_traffic_report', sendTo: sendTo(text) };
  if (/^(推送)?(公域)?日报到群$/.test(text)) return { type: 'push_latest_report_to_group' };
  if (/^重发.*(公域)?日报/.test(text)) return { type: 'resend_latest_report', sendTo: sendTo(text) };
  if (/^(同步|拉取|更新).*(关单|关单反馈)/.test(text)) return { type: 'sync_closed_order_feedback' };
  if (/^(跑|生成|执行).*(关单观察|关单报告|关单反馈观察)/.test(text)) return { type: 'run_closed_order_observation_report' };
  if (/(今日|今天|现在).*(咋样|怎么样|概况|数据|日报|看下|看看)/.test(text)) return { type: 'latest_summary' };
  if (/^(?:Agent|agent|智能体语义|语义)(?:学习|迭代).*(?:汇总|总结|历史|统计)$|^(?:Agent|agent|智能体语义|语义)(?:学习|迭代)$/.test(text)) {
    return { type: 'agent_learning_summary' };
  }
  if (/^(运营学习|学习反馈).*(历史|统计)$/.test(text)) return { type: 'operations_learning_history' };
  if (/^(运营学习|学习反馈).*(汇总|总结)$/.test(text)) return { type: 'operations_learning_summary' };
  if (/^(运营学习|学习测验|今日测验|loop测验|运营测验|测验)$|学习\s*loop|运营学习\s*loop/i.test(text)) return { type: 'operations_learning_quiz' };
  if (/^(差异化定价|配置差异化定价)$/.test(text)) return { type: 'differential_pricing_card' };
  if (/^库存情况$/.test(text)) return { type: 'inventory_status_overview' };
  const inventoryQuery = /^库存情况\s+(.+)$/.exec(text);
  if (inventoryQuery) return { type: 'inventory_status_query', query: inventoryQuery[1].trim() };
  if (/^(链接档案概览|链接概览)$/.test(text)) return { type: 'link_registry_overview' };
  if (/^(?:商品)?ID(?:查询|互查|转换|换算)$|^打开(?:商品)?ID(?:查询|互查|转换|换算)$|^查ID$/i.test(text)) return { type: 'lookup_product_id_card' };

  const rentalPriceChange = parseRentalPriceChange(text);
  if (rentalPriceChange) return { type: 'rental_price_change', productId: rentalPriceChange.productId, request: rentalPriceChange };

  const rentalCopy = parseRentalCopyCommand(text);
  if (rentalCopy) return { type: 'rental_copy', productId: rentalCopy };

  const delist = parseDelistCommand(text);
  if (delist) return { type: 'rental_delist', productId: delist };

  const tenancySet = parseTenancySetCommand(text);
  if (tenancySet) return { type: 'rental_tenancy_set', productId: tenancySet.productId, days: tenancySet.days };

  const specDiscover = parseSpecDiscoverCommand(text);
  if (specDiscover) return { type: 'rental_spec_discover', productId: specDiscover };

  const specAdd = parseSpecAddCommand(text);
  if (specAdd) return { type: 'rental_spec_add', productId: specAdd.productId, itemTitle: specAdd.itemTitle };

  const idLookup = /^(?:查ID|ID查询)\s*(\d+)$/.exec(text)
    ?? /^(端内(?:ID)?\s*\d+)(?:对应平台|的平台ID)?$/.exec(text)
    ?? /^(平台(?:商品)?ID\s*(?:转端内\s*)?\d+)$/.exec(text)
    ?? /^(\d+)\s*的平台ID$/.exec(text)
    ?? /^(20\d{18,})\s*的端内ID$/.exec(text);
  if (idLookup) return { type: 'lookup_product_id', query: idLookup[1].trim() };

  const query = /^(?:查询商品|查商品查询|查商品|查询|商品)\s+(.+)$/.exec(text)
    ?? /^这个商品\s+(.+?)\s*(?:数据如何|怎么样|如何)?$/.exec(text);
  if (query) return { type: 'query_product', keyword: query[1].trim() };

  return { type: 'unknown', text };
}

export function parseBotIntent(input: string): BotIntent {
  const text = normalize(input);
  if (!text) return { type: 'help' };

  const exact = parseExactBotIntent(text);
  if (exact.type !== 'unknown') return exact;

  if (looksLikeNewLinkWriteIntent(text)) return { type: 'unknown', text };

  const alias = resolveSemanticAlias(text);
  if (alias !== undefined) return alias;

  if (/日报/.test(text)) return { type: 'latest_summary' };

  return { type: 'unknown', text };
}
