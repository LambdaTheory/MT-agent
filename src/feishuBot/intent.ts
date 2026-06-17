import type { BotIntent, FeishuSendTo } from './types.js';
import { parseRentalCopyCommand, parseRentalPriceChange, parseDelistCommand, parseTenancySetCommand, parseSpecDiscoverCommand, parseSpecAddCommand } from './rentalPrice.js';
import { resolveSemanticAlias } from './semanticAlias.js';

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function sendTo(text: string): FeishuSendTo | undefined {
  if (/发全部|发两边|both/i.test(text)) return 'both';
  if (/发群|群里|group/i.test(text)) return 'group';
  if (/发我|个人|personal/i.test(text)) return 'personal';
  return undefined;
}

/**
 * Exact/regex parser — the original parseBotIntent logic.
 *
 * Returns the same intent as the original parser for all explicit commands.
 * Does NOT include the broad /日报/ catch-all (which is in parseBotIntent
 * after semantic aliases), so that natural phrases like "发个日报" can
 * be routed to run_public_traffic_report via resolveSemanticAlias instead
 * of being swallowed by the broad latest_summary pattern.
 *
 * Exported separately so tests can verify exact parser behavior in isolation.
 */
export function parseExactBotIntent(input: string): BotIntent {
  const text = normalize(input);
  if (!text) return { type: 'help' };
  if (/^(帮助|help|\/help)$/i.test(text)) return { type: 'help' };
  if (/^(跑|生成|执行).*(公域)?日报/.test(text)) return { type: 'run_public_traffic_report', sendTo: sendTo(text) };
  if (/^推送(日报|公域日报)到群$/.test(text)) return { type: 'push_latest_report_to_group' };
  if (/^重发.*(公域)?日报/.test(text)) return { type: 'resend_latest_report', sendTo: sendTo(text) };
  // Exact summary queries (intentional, not broad catch-all)
  if (/(今日|今天|现在).*(咋样|怎么样|概况|数据|日报|看下|看看)/.test(text)) return { type: 'latest_summary' };
  if (/^(运营学习|学习反馈).*(历史|统计)$/.test(text)) return { type: 'operations_learning_history' };
  if (/^(运营学习|学习反馈).*(汇总|总结)$/.test(text)) return { type: 'operations_learning_summary' };
  if (/^(运营学习|学习测验|今日测验|loop测验|运营测验|测验)$|学习\s*loop|运营学习\s*loop/i.test(text)) return { type: 'operations_learning_quiz' };
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

  const query = /^(?:查询商品|查商品|查询|商品)\s+(.+)$/.exec(text)
    ?? /^这个商品\s+(.+?)\s*(?:数据如何|怎么样|如何)?$/.exec(text);
  if (query) return { type: 'query_product', keyword: query[1].trim() };

  return { type: 'unknown', text };
}

/**
 * parseBotIntent — intent resolution pipeline.
 *
 * Resolution order:
 * 1. parseExactBotIntent — exact/regex patterns win first
 * 2. resolveSemanticAlias — deterministic natural-language aliases
 * 3. Broad catch-all patterns (e.g. any text containing "日报" → latest_summary)
 * 4. unknown fallback
 *
 * This ensures:
 * - Exact commands always win (e.g. "跑日报" → run_public_traffic_report)
 * - Semantic aliases fill the gap for natural phrases (e.g. "发个日报" → run_public_traffic_report)
 * - Broad patterns still catch complaints (e.g. "日报数据不对" → latest_summary, known risk)
 * - Rental write natural language stays unknown (e.g. "帮我把 761 下架" → unknown)
 */
export function parseBotIntent(input: string): BotIntent {
  const text = normalize(input);
  if (!text) return { type: 'help' };

  // Step 1: Exact parser wins first
  const exact = parseExactBotIntent(text);
  if (exact.type !== 'unknown') return exact;

  // Step 2: Semantic aliases for natural-language phrases
  const alias = resolveSemanticAlias(text);
  if (alias !== undefined) return alias;

  // Step 3: Broad catch-all patterns (preserving known risk behavior)
  // Any text containing "日报" becomes latest_summary (read-only, safe)
  if (/日报/.test(text)) return { type: 'latest_summary' };

  // Step 4: unknown fallback
  return { type: 'unknown', text };
}
