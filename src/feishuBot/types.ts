export type FeishuSendTo = 'personal' | 'group' | 'both';

export type BotIntent =
  | { type: 'help' }
  | { type: 'run_public_traffic_report'; sendTo?: FeishuSendTo }
  | { type: 'resend_latest_report'; sendTo?: FeishuSendTo }
  | { type: 'push_latest_report_to_group' }
  | { type: 'latest_summary' }
  | { type: 'query_product'; keyword: string }
  | { type: 'unknown'; text: string };

export interface BotResponse {
  text: string;
}

export interface FeishuMessageEvent {
  schema?: string;
  header?: { event_type?: string; token?: string; event_id?: string };
  event?: {
    message?: {
      message_id?: string;
      chat_id?: string;
      chat_type?: string;
      content?: string;
      message_type?: string;
    };
    sender?: {
      sender_id?: { open_id?: string; user_id?: string };
    };
  };
}

export interface FeishuUrlVerificationPayload {
  type?: string;
  challenge?: string;
  token?: string;
}

export type FeishuBotMessageSource = 'sdk' | 'http';

export interface FeishuBotIncomingTextMessage {
  messageId: string;
  text: string;
  source: FeishuBotMessageSource;
  chatId?: string;
  senderOpenId?: string;
}

export interface FeishuBotDispatchResult extends BotResponse {
  skipped: boolean;
}

export type BotIntentResolver = (text: string, message: FeishuBotIncomingTextMessage) => BotIntent;

export type FutureBotIntentHook = 'ask_report_question' | 'suggest_operation' | 'request_approval' | 'execute_operation';
