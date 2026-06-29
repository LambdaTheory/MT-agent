import type { BotIntent, FeishuSendTo } from './types.js';

function extractSendTo(text: string): FeishuSendTo | undefined {
  if (/(发全部|发两边|both)/i.test(text)) return 'both';
  if (/(发群|群里|group)/i.test(text)) return 'group';
  if (/(发我|个人|personal)/i.test(text)) return 'personal';
  return undefined;
}

const REPORT_PATTERNS = [
  /^(?:发|做|跑)(?:个|一下|一)?(?:公域)?日报/,
];

const PUSH_PATTERNS = [
  /^推送(?:日报|公域日报)?到群/,
  /^发到群里/,
  /^日报推到群里/,
  /^日报推送到群/,
];

const QUIZ_PATTERNS = [
  /^(?:做|来|开始|出)(?:个|一下|一)?(?:运营)?(?:测验|题)/,
  /^(?:做|来|开始)(?:个|一下|一)?运营学习/,
];

const CLOSED_ORDER_REPORT_PATTERNS = [
  /^(?:发|做|跑)(?:个|一下|一)?关单观察/,
  /^(?:发|做|跑)(?:个|一下|一)?关单报告/,
];

const CLOSED_ORDER_SYNC_PATTERNS = [
  /^(?:同步|拉取|更新)(?:一下|一波|一)?关单/,
];

function firstMatch(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function resolveSemanticAlias(input: string): BotIntent | undefined {
  const text = input.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;

  if (firstMatch(text, REPORT_PATTERNS)) return { type: 'run_public_traffic_report', sendTo: extractSendTo(text) };
  if (firstMatch(text, PUSH_PATTERNS)) return { type: 'push_latest_report_to_group' };
  if (firstMatch(text, QUIZ_PATTERNS)) return { type: 'operations_learning_quiz' };
  if (firstMatch(text, CLOSED_ORDER_REPORT_PATTERNS)) return { type: 'run_closed_order_observation_report' };
  if (firstMatch(text, CLOSED_ORDER_SYNC_PATTERNS)) return { type: 'sync_closed_order_feedback' };
  return undefined;
}
