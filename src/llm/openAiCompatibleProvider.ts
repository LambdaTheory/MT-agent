import { parseLlmJsonObject } from './json.js';
import type { LlmGenerateJsonInput, LlmProvider, LlmProviderResult } from './provider.js';

export interface OpenAiCompatibleLlmEnv {
  LLM_PROVIDER?: string;
  LLM_BASE_URL?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
  MT_AGENT_LLM_PROVIDER?: string;
  MT_AGENT_LLM_BASE_URL?: string;
  MT_AGENT_LLM_API_KEY?: string;
  MT_AGENT_LLM_MODEL?: string;
}

export interface OpenAiCompatibleLlmProviderConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  fetchImpl?: typeof fetch;
}

interface ChatCompletionResponse {
  model?: unknown;
  choices?: Array<{ message?: { content?: unknown } }>;
}

function normalized(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

function isChatCompletionResponse(value: unknown): value is ChatCompletionResponse {
  return typeof value === 'object' && value !== null;
}

export class OpenAiCompatibleLlmProvider implements LlmProvider {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: OpenAiCompatibleLlmProviderConfig) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async generateJson(input: LlmGenerateJsonInput): Promise<LlmProviderResult> {
    const response = await this.fetchImpl(chatCompletionsUrl(this.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        messages: input.messages,
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
        ...(input.maxTokens !== undefined ? { max_tokens: input.maxTokens } : {}),
      }),
    });

    if (!response.ok) throw new Error(`LLM provider request failed: ${response.status}`);
    const payload: unknown = await response.json();
    if (!isChatCompletionResponse(payload)) throw new Error('LLM response must be an object');
    const text = payload.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('LLM provider response missing message content');
    return { text, json: parseLlmJsonObject(text), model: this.model };
  }
}

export function createLlmProviderFromEnv(env: OpenAiCompatibleLlmEnv = process.env, fetchImpl: typeof fetch = fetch): LlmProvider | null {
  const providerName = normalized(env.MT_AGENT_LLM_PROVIDER) ?? normalized(env.LLM_PROVIDER);
  if (providerName === 'disabled') return null;
  const baseUrl = normalized(env.MT_AGENT_LLM_BASE_URL) ?? normalized(env.LLM_BASE_URL);
  const model = normalized(env.MT_AGENT_LLM_MODEL) ?? normalized(env.LLM_MODEL);
  if (!baseUrl || !model) return null;
  const apiKey = normalized(env.MT_AGENT_LLM_API_KEY) ?? normalized(env.LLM_API_KEY);
  return new OpenAiCompatibleLlmProvider({ baseUrl, model, apiKey, fetchImpl });
}

export function createOpenAiCompatibleProviderFromEnv(env: OpenAiCompatibleLlmEnv = process.env): OpenAiCompatibleLlmProvider | null {
  const baseUrl = normalized(env.LLM_BASE_URL);
  const apiKey = normalized(env.LLM_API_KEY);
  const model = normalized(env.LLM_MODEL);
  if (!baseUrl || !apiKey || !model) return null;
  return new OpenAiCompatibleLlmProvider({ baseUrl, apiKey, model });
}
