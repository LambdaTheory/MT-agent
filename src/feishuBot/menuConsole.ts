import { buildHealthReportCard, checkHealth } from '../health/healthService.js';
import type { FeishuCardPayload } from '../notify/feishuApp.js';

export const FEISHU_BOT_MENU_EVENT_TYPES = [
  'application.bot.menu_v6',
  'app_menu.event',
  'bot_menu.event',
  'bot.menu.event',
] as const;

export const HEALTH_MENU_EVENT_KEYS = new Set([
  '/health',
  'health',
  'health.overview',
  'health.shallow',
  'console.health',
]);

export interface FeishuBotMenuEvent {
  eventType: string;
  eventKey: string;
  openId?: string;
  chatId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readNestedOpenId(event: Record<string, unknown>): string | undefined {
  const operator = isRecord(event.operator) ? event.operator : undefined;
  const operatorId = isRecord(operator?.operator_id) ? operator.operator_id : undefined;
  const sender = isRecord(event.sender) ? event.sender : undefined;
  const senderId = isRecord(sender?.sender_id) ? sender.sender_id : undefined;
  return readString(operatorId?.open_id)
    ?? readString(operator?.open_id)
    ?? readString(senderId?.open_id)
    ?? readString(event.open_id);
}

export function extractFeishuBotMenuEvent(payload: unknown): FeishuBotMenuEvent | null {
  if (!isRecord(payload)) return null;
  const header = isRecord(payload.header) ? payload.header : undefined;
  const event = isRecord(payload.event) ? payload.event : undefined;
  const eventType = readString(header?.event_type);
  if (!eventType || !FEISHU_BOT_MENU_EVENT_TYPES.includes(eventType as (typeof FEISHU_BOT_MENU_EVENT_TYPES)[number]) || !event) return null;
  const eventKey = readString(event.event_key) ?? readString(event.menu_key) ?? readString(event.key);
  if (!eventKey) return null;
  return {
    eventType,
    eventKey,
    ...(readNestedOpenId(event) ? { openId: readNestedOpenId(event) } : {}),
    ...(readString(event.open_chat_id) ?? readString(event.chat_id) ? { chatId: readString(event.open_chat_id) ?? readString(event.chat_id) } : {}),
  };
}

function basicConsoleCard(menuEvent: FeishuBotMenuEvent): FeishuCardPayload {
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: 'MT-agent 控制台' }, template: 'blue' },
    body: {
      elements: [{
        tag: 'markdown',
        content: [
          `已收到菜单入口：${menuEvent.eventKey}`,
          '',
          '第一版已支持：',
          '- `health.overview` / `/health`：系统健康检查',
          '',
          '后续会继续补 AgentTask、日报重发和待确认任务入口。',
        ].join('\n'),
      }],
    },
  };
}

export async function buildFeishuBotMenuConsoleCard(menuEvent: FeishuBotMenuEvent, outputDir?: string): Promise<FeishuCardPayload> {
  if (HEALTH_MENU_EVENT_KEYS.has(menuEvent.eventKey)) {
    return buildHealthReportCard(await checkHealth({ outputDir }));
  }
  return basicConsoleCard(menuEvent);
}
