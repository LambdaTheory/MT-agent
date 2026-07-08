import type { FeishuCardPayload } from '../notify/feishuApp.js';
import type { RentalPriceChangeRequest } from './rentalPrice.js';

export type FeishuSendTo = 'personal' | 'group' | 'both';
export type LinkRegistryMaintenanceSourceMode = 'daemon_only';

export type BotIntent =
  | { type: 'help' }
  | { type: 'differential_pricing_card' }
  | { type: 'cancel_differential_pricing_card' }
  | { type: 'run_public_traffic_report'; sendTo?: FeishuSendTo }
  | { type: 'refresh_public_traffic_dashboard'; sendTo?: FeishuSendTo }
  | { type: 'resend_latest_report'; sendTo?: FeishuSendTo; date?: string }
  | { type: 'push_latest_report_to_group'; date?: string }
  | { type: 'sync_closed_order_feedback' }
  | { type: 'run_closed_order_observation_report' }
  | { type: 'latest_summary'; date?: string }
  | { type: 'conversion_summary'; date?: string }
  | { type: 'operations_learning_quiz' }
  | { type: 'operations_learning_summary' }
  | { type: 'operations_learning_history' }
  | { type: 'agent_learning_summary' }
  | { type: 'query_product'; keyword: string; date?: string }
  | { type: 'lookup_product_id_card' }
  | { type: 'link_registry_overview' }
  | { type: 'link_registry_maintenance_prompt'; sourceMode?: LinkRegistryMaintenanceSourceMode }
  | { type: 'link_registry_governance_prompt' }
  | { type: 'link_registry_maintenance_hub' }
  | { type: 'inventory_status_overview' }
  | { type: 'inventory_status_query'; query: string }
  | { type: 'lookup_product_id'; query: string; date?: string }
  | { type: 'rental_price_change'; productId: string; request: RentalPriceChangeRequest }
  | { type: 'rental_copy'; productId: string }
  | { type: 'rental_delist'; productId: string }
  | { type: 'rental_tenancy_set'; productId: string; days: string }
  | { type: 'rental_spec_discover'; productId: string }
  | { type: 'rental_spec_add'; productId: string; specDimId: string; itemTitle: string }
  | { type: 'unknown'; text: string };

export interface BotResponse {
  text: string;
  card?: FeishuCardPayload;
  metadata?: Record<string, unknown>;
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
