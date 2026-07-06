import type { BotIntent, FeishuSendTo } from './types.js';
import {
  parseDelistCommand,
  parseRentalCopyCommand,
  parseRentalPriceChange,
  parseSpecAddCommand,
  parseSpecDiscoverCommand,
  parseTenancySetCommand,
} from './rentalPrice.js';
import { parseNumericProductIdList } from './reportStore.js';
import { resolveSemanticAlias } from './semanticAlias.js';

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function stripTrailingHarmlessPunctuation(text: string): string {
  return normalize(text.replace(/[;；。!！?？,，、]+$/gu, ''));
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

function looksLikeReportComparisonQuestion(text: string): boolean {
  const compact = text.toLowerCase().replace(/\s+/g, '');
  const hasMetric = /(转化率|转化数据|曝光|访问|发货|订单|金额|创建率|发货率|关单率|客单价)/.test(compact);
  if (!hasMetric) return false;

  const hasCompareWord = /(对比|比较|相比|环比|同比|较|比|变化|涨跌|差异|提升|下降|上升|vs)/i.test(compact);
  const hasRangeWord = /(上周|本周|这周|本星期|上星期|上月|本月|这个月|近\d+天|过去\d+天|前一段|上一段|昨天|前日|前一天|上一天)/.test(compact);
  const datePattern = String.raw`(?:20\d{2}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}月\d{1,2}日?|\d{1,2}[-./]\d{1,2})`;
  const hasTwoDates = new RegExp(`${datePattern}.*(?:和|与|跟|比|vs).*${datePattern}`, 'i').test(compact);
  return hasCompareWord && (hasRangeWord || hasTwoDates);
}

function looksLikeReportComplaint(text: string): boolean {
  const compact = text.replace(/\s+/g, '');
  return /日报/.test(compact) && /(不对|有问题|异常|错误|错了|差|坏了|怎么这么)/.test(compact);
}

function parseShortMultiProductQuery(text: string): string | null {
  const match = /^查\s*(.+)$/.exec(text);
  if (!match) return null;
  const productIds = parseNumericProductIdList(match[1]);
  return productIds.length > 0 ? productIds.join(', ') : null;
}

function looksLikeInternalProductIdQuery(text: string): string | null {
  const match = /^(?:查询商品|查商品|查询|查|商品)\s*(\d{3,6})$/.exec(text);
  return match?.[1] ?? null;
}

interface DateHint {
  date: string;
  raw: string;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function offsetLocalDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return formatLocalDate(date);
}

function currentLocalYear(): number {
  return new Date().getFullYear();
}

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function dateHintFromParts(raw: string, year: number, month: number, day: number): DateHint | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return { date: `${year}-${padDatePart(month)}-${padDatePart(day)}`, raw };
}

function parseDateHint(text: string): DateHint | null {
  const absolute = /\b(20\d{2})[-./](\d{1,2})[-./](\d{1,2})\b/.exec(text);
  if (absolute?.[1] && absolute[2] && absolute[3]) {
    const parsed = dateHintFromParts(absolute[0], Number(absolute[1]), Number(absolute[2]), Number(absolute[3]));
    if (parsed) return parsed;
  }

  const shortYear = /(^|[^\d])(\d{2})[./-](\d{1,2})[./-](\d{1,2})(?!\d)/.exec(text);
  if (shortYear?.[2] && shortYear[3] && shortYear[4]) {
    const raw = shortYear[0].slice(shortYear[1]?.length ?? 0);
    const parsed = dateHintFromParts(raw, 2000 + Number(shortYear[2]), Number(shortYear[3]), Number(shortYear[4]));
    if (parsed) return parsed;
  }

  const monthDayWithChinese = /(\d{1,2})\s*\u6708\s*(\d{1,2})\s*\u65e5?/.exec(text);
  if (monthDayWithChinese?.[1] && monthDayWithChinese[2]) {
    const parsed = dateHintFromParts(monthDayWithChinese[0], currentLocalYear(), Number(monthDayWithChinese[1]), Number(monthDayWithChinese[2]));
    if (parsed) return parsed;
  }

  const monthDay = /(^|[^\d])(\d{1,2})[./-](\d{1,2})(?!\d)/.exec(text);
  if (monthDay?.[2] && monthDay[3]) {
    const raw = monthDay[0].slice(monthDay[1]?.length ?? 0);
    const parsed = dateHintFromParts(raw, currentLocalYear(), Number(monthDay[2]), Number(monthDay[3]));
    if (parsed) return parsed;
  }

  const relative = /(昨天|前天)/.exec(text);
  if (!relative?.[1]) return null;
  return { date: relative[1] === '昨天' ? offsetLocalDate(-1) : offsetLocalDate(-2), raw: relative[1] };
}

function stripDateHint(text: string, hint: DateHint): string {
  return normalize(text.replace(hint.raw, ' ').replace(/的/g, ' '));
}

function cleanDatedProductKeyword(keyword: string): string {
  return keyword
    .replace(/[?？!！。；;，,、]+$/g, '')
    .replace(/\s*(?:的数据|数据|表现|怎么样|如何)$/g, '')
    .trim();
}

function parseDatedReadIntent(text: string): BotIntent | null {
  const hint = parseDateHint(text);
  if (!hint) return null;

  const rest = stripDateHint(text, hint);
  if (/转化率|转化数据|转化/.test(rest)) return { type: 'conversion_summary', date: hint.date };

  const idLookup = /^(?:查\s*ID|ID\s*查询)\s*(\d+)$/i.exec(rest);
  if (idLookup?.[1]) return { type: 'lookup_product_id', query: idLookup[1], date: hint.date };

  const internalProductIdQuery = looksLikeInternalProductIdQuery(rest);
  if (internalProductIdQuery) return { type: 'query_product', keyword: internalProductIdQuery, date: hint.date };

  const query = /^(?:查询商品|查商品|查询|查|商品)\s+(.+)$/.exec(rest);
  if (query?.[1]) {
    const keyword = cleanDatedProductKeyword(query[1]);
    if (keyword && !/^(?:日报|概况|数据)$/.test(keyword)) {
      return { type: 'query_product', keyword, date: hint.date };
    }
  }

  if (/(日报|概况|数据)/.test(rest) || /(日报|概况|数据)/.test(text)) {
    return { type: 'latest_summary', date: hint.date };
  }

  return null;
}

function pushLatestReportIntentWithDate(text: string): BotIntent {
  const date = parseDateHint(text)?.date;
  return date ? { type: 'push_latest_report_to_group', date } : { type: 'push_latest_report_to_group' };
}

function resendLatestReportIntentWithDate(text: string): BotIntent {
  const date = parseDateHint(text)?.date;
  return {
    type: 'resend_latest_report',
    sendTo: sendTo(text),
    ...(date ? { date } : {}),
  };
}

export function parseExactBotIntent(input: string): BotIntent {
  const text = normalize(input);
  const canonicalText = stripTrailingHarmlessPunctuation(text);
  if (!canonicalText) return { type: 'help' };
  if (/^(帮助|help|\/help)$/i.test(canonicalText)) return { type: 'help' };
  if (/^(跑|生成|执行).*(公域)?日报/.test(canonicalText)) return { type: 'run_public_traffic_report', sendTo: sendTo(canonicalText) };
  if (/^(抓取|补抓|刷新|更新).*(访问页|后链路|访问数据)/.test(canonicalText)) return { type: 'refresh_public_traffic_dashboard', sendTo: sendTo(canonicalText) };
  if (/^(推送)?(公域)?日报到群$/.test(canonicalText) || /^(推送|发送).*(公域)?日报.*(到群|群里)$/.test(canonicalText)) return pushLatestReportIntentWithDate(canonicalText);
  if (/^重发.*(公域)?日报/.test(canonicalText)) return resendLatestReportIntentWithDate(canonicalText);
  if (/^(同步|拉取|更新).*(关单|关单反馈)/.test(canonicalText)) return { type: 'sync_closed_order_feedback' };
  if (/^(跑|生成|执行).*(关单观察|关单报告|关单反馈观察)/.test(canonicalText)) return { type: 'run_closed_order_observation_report' };
  if (looksLikeReportComparisonQuestion(canonicalText)) return { type: 'unknown', text };
  if (looksLikeReportComplaint(canonicalText)) return { type: 'unknown', text };
  const datedReadIntent = parseDatedReadIntent(canonicalText);
  if (datedReadIntent) return datedReadIntent;
  if (/^(?:(?:帮我)?看(?:下|看)?|查看|可以重新看下)?\s*(?:公域)?日报(?:概况)?(?:吗)?$/.test(canonicalText)) return { type: 'latest_summary' };
  if (/^(今日|今天|现在)(?:公域)?(?:概况|数据)$/.test(canonicalText)) return { type: 'latest_summary' };
  if (/转化率|转化数据/.test(canonicalText)) return { type: 'conversion_summary' };
  if (/^(?:Agent|agent|智能体语义|语义)(?:学习|迭代).*(?:汇总|总结|历史|统计)$|^(?:Agent|agent|智能体语义|语义)(?:学习|迭代)$/.test(canonicalText)) {
    return { type: 'agent_learning_summary' };
  }
  if (/^(运营学习|学习反馈).*(历史|统计)$/.test(canonicalText)) return { type: 'operations_learning_history' };
  if (/^(运营学习|学习反馈).*(汇总|总结)$/.test(canonicalText)) return { type: 'operations_learning_summary' };
  if (/^(开始)?(运营学习|学习测验|今日测验|loop测验|运营测验|测验)$|学习\s*loop|运营学习\s*loop/i.test(canonicalText)) return { type: 'operations_learning_quiz' };
  if (/^(差异化定价|配置差异化定价)$/.test(canonicalText)) return { type: 'differential_pricing_card' };
  if (/^取消差异化定价$/.test(canonicalText)) return { type: 'cancel_differential_pricing_card' };
  if (/^库存情况$/.test(canonicalText)) return { type: 'inventory_status_overview' };
  const inventoryQuery = /^库存情况\s+(.+)$/.exec(canonicalText);
  const matchedInventoryQuery = inventoryQuery?.[1];
  if (matchedInventoryQuery) return { type: 'inventory_status_query', query: matchedInventoryQuery!.trim() };
  if (/^(链接档案概览|链接概览)$/.test(canonicalText)) return { type: 'link_registry_overview' };
  if (/^(链接维护|开始链接维护|打开链接维护|呼出链接维护卡)$/.test(canonicalText)) return { type: 'link_registry_maintenance_prompt' };
  if (/^(组级治理|链接治理|开始组级治理|打开组级治理|呼出组级治理卡)$/.test(canonicalText)) return { type: 'link_registry_governance_prompt' };
  if (/^(链接档案维护|维护链接档案|链接维护卡|链接档案治理)$/.test(canonicalText)) return { type: 'link_registry_maintenance_hub' };
  if (/^(?:商品)?ID(?:查询|互查|转换|换算)$|^打开(?:商品)?ID(?:查询|互查|转换|换算)$|^查ID$/i.test(canonicalText)) return { type: 'lookup_product_id_card' };

  const internalProductIdQuery = looksLikeInternalProductIdQuery(canonicalText);
  if (internalProductIdQuery) return { type: 'query_product', keyword: internalProductIdQuery };

  if (/^(链接维护|开始链接维护|打开链接维护|呼出链接维护卡)\s+daemon$/i.test(canonicalText)) {
    return { type: 'link_registry_maintenance_prompt', sourceMode: 'daemon_only' };
  }

  const shortMultiProductQuery = parseShortMultiProductQuery(canonicalText);
  if (shortMultiProductQuery) return { type: 'query_product', keyword: shortMultiProductQuery };

  const rentalPriceChange = parseRentalPriceChange(canonicalText);
  if (rentalPriceChange) return { type: 'rental_price_change', productId: rentalPriceChange.productId, request: rentalPriceChange };

  const rentalCopy = parseRentalCopyCommand(canonicalText);
  if (rentalCopy) return { type: 'rental_copy', productId: rentalCopy };

  const delist = parseDelistCommand(canonicalText);
  if (delist) return { type: 'rental_delist', productId: delist };

  const tenancySet = parseTenancySetCommand(canonicalText);
  if (tenancySet) return { type: 'rental_tenancy_set', productId: tenancySet.productId, days: tenancySet.days };

  const specDiscover = parseSpecDiscoverCommand(canonicalText);
  if (specDiscover) return { type: 'rental_spec_discover', productId: specDiscover };

  const specAdd = parseSpecAddCommand(canonicalText);
  if (specAdd) return { type: 'rental_spec_add', productId: specAdd.productId, specDimId: specAdd.specDimId, itemTitle: specAdd.itemTitle };

  const idLookup = /^(?:查ID|ID查询)\s*(\d+)$/.exec(canonicalText)
    ?? /^(端内(?:ID)?\s*\d+)(?:对应平台|的平台ID)?$/.exec(canonicalText)
    ?? /^(平台(?:商品)?ID\s*(?:转端内\s*)?\d+)$/.exec(canonicalText)
    ?? /^(\d+)\s*的平台ID$/.exec(canonicalText)
    ?? /^(20\d{18,})\s*的端内ID$/.exec(canonicalText);
  if (idLookup) return { type: 'lookup_product_id', query: idLookup[1].trim() };

  const query = /^(?:查询商品|查商品查询|查商品|查询|商品)\s+(.+)$/.exec(canonicalText)
    ?? /^这个商品\s+(.+?)\s*(?:数据如何|怎么样|如何)?$/.exec(canonicalText);
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

  return { type: 'unknown', text };
}

function isAgentFirstLocalDirectIntent(intent: BotIntent): boolean {
  switch (intent.type) {
    case 'help':
    case 'operations_learning_quiz':
    case 'operations_learning_summary':
    case 'operations_learning_history':
    case 'agent_learning_summary':
    case 'lookup_product_id_card':
    case 'lookup_product_id':
    case 'link_registry_overview':
    case 'link_registry_maintenance_prompt':
    case 'link_registry_governance_prompt':
    case 'link_registry_maintenance_hub':
    case 'inventory_status_overview':
    case 'differential_pricing_card':
    case 'cancel_differential_pricing_card':
      return true;
    default:
      return false;
  }
}

export function parseAgentFirstBotIntent(input: string): BotIntent {
  const text = normalize(input);
  if (!text) return { type: 'help' };

  const localIntent = parseBotIntent(text);
  if (isAgentFirstLocalDirectIntent(localIntent)) return localIntent;

  return { type: 'unknown', text };
}
