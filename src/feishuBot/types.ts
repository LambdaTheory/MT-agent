import type { FeishuCardPayload } from '../notify/feishuApp.js';
import type { RentalPriceChangeRequest } from './rentalPrice.js';

export type FeishuSendTo = 'personal' | 'group' | 'both';

export type BotIntent =
  | { type: 'help' }
  | { type: 'differential_pricing_card' }
  | { type: 'run_public_traffic_report'; sendTo?: FeishuSendTo }
  | { type: 'resend_latest_report'; sendTo?: FeishuSendTo }
  | { type: 'push_latest_report_to_group' }
  | { type: 'sync_closed_order_feedback' }
  | { type: 'run_closed_order_observation_report' }
  | { type: 'latest_summary' }
  | { type: 'operations_learning_quiz' }
  | { type: 'operations_learning_summary' }
  | { type: 'operations_learning_history' }
  | { type: 'agent_learning_summary' }
  | { type: 'query_product'; keyword: string }
  | { type: 'lookup_product_id_card' }
  | { type: 'link_registry_overview' }
  | { type: 'inventory_status_overview' }
  | { type: 'inventory_status_query'; query: string }
  | { type: 'lookup_product_id'; query: string }
  | { type: 'rental_price_change'; productId: string; request: RentalPriceChangeRequest }
  | { type: 'rental_copy'; productId: string }
  | { type: 'rental_delist'; productId: string }
  | { type: 'rental_tenancy_set'; productId: string; days: string }
  | { type: 'rental_spec_discover'; productId: string }
  | { type: 'rental_spec_add'; productId: string; itemTitle: string }
  | { type: 'unknown'; text: string };

export interface BotResponse {
  text: string;
  card?: FeishuCardPayload;
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
      mentions?: FeishuBotMessageMention[];
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
  chatType?: string;
  senderOpenId?: string;
  mentions?: FeishuBotMessageMention[];
}

export interface FeishuBotMessageMention {
  key?: string;
  id?: Record<string, string>;
  name?: string;
}

export interface FeishuBotDispatchResult extends BotResponse {
  skipped: boolean;
}

export type BotIntentResolver = (text: string, message: FeishuBotIncomingTextMessage) => BotIntent;

export type FutureBotIntentHook = 'ask_report_question' | 'suggest_operation' | 'request_approval' | 'execute_operation';
