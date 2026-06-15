export type LlmRole = 'system' | 'user' | 'assistant';

export interface LlmChatMessage {
  role: LlmRole;
  content: string;
}

export interface LlmGenerateJsonInput {
  messages: LlmChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface LlmProviderResult {
  text: string;
  json: Record<string, unknown>;
  model?: string;
}

export interface LlmProvider {
  generateJson(input: LlmGenerateJsonInput): Promise<LlmProviderResult>;
}
