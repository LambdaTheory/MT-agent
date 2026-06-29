import { parseLlmJsonObject } from './json.js';
import type { LlmGenerateJsonInput, LlmProvider, LlmProviderResult } from './provider.js';

export interface OpenAiCompatibleLlmEnv {
  LLM_PROVIDER?: string;
  LLM_BASE_URL?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
  LLM_TIMEOUT_MS?: string;
  MT_AGENT_LLM_PROVIDER?: string;
  MT_AGENT_LLM_BASE_URL?: string;
  MT_AGENT_LLM_API_KEY?: string;
  MT_AGENT_LLM_MODEL?: string;
  MT_AGENT_LLM_TIMEOUT_MS?: string;
}

export interface OpenAiCompatibleLlmProviderConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface LlmProviderEnvSummary {
  enabled: boolean;
  reason: string;
  providerName?: string;
  model?: string;
  apiKeyConfigured: boolean;
  missingKeys: string[];
}

interface ChatCompletionResponse {
  model?: unknown;
  choices?: Array<{ message?: { content?: unknown } }>;
}

const DEFAULT_LLM_TIMEOUT_MS = 45_000;

function normalized(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function envValue(env: OpenAiCompatibleLlmEnv, primary: keyof OpenAiCompatibleLlmEnv, fallback: keyof OpenAiCompatibleLlmEnv): string | undefined {
  return normalized(env[primary]) ?? normalized(env[fallback]);
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function summarizeLlmProviderEnv(env: OpenAiCompatibleLlmEnv = process.env): LlmProviderEnvSummary {
  const providerName = envValue(env, 'MT_AGENT_LLM_PROVIDER', 'LLM_PROVIDER');
  if (providerName === 'disabled') {
    return {
      enabled: false,
      reason: 'disabled by provider setting',
      providerName,
      apiKeyConfigured: Boolean(envValue(env, 'MT_AGENT_LLM_API_KEY', 'LLM_API_KEY')),
      missingKeys: [],
    };
  }

  const baseUrl = envValue(env, 'MT_AGENT_LLM_BASE_URL', 'LLM_BASE_URL');
  const model = envValue(env, 'MT_AGENT_LLM_MODEL', 'LLM_MODEL');
  const apiKey = envValue(env, 'MT_AGENT_LLM_API_KEY', 'LLM_API_KEY');
  const missingKeys = [
    ...(baseUrl ? [] : ['MT_AGENT_LLM_BASE_URL or LLM_BASE_URL']),
    ...(model ? [] : ['MT_AGENT_LLM_MODEL or LLM_MODEL']),
  ];

  if (missingKeys.length > 0) {
    return {
      enabled: false,
      reason: `missing ${missingKeys.join(', ')}`,
      ...(providerName ? { providerName } : {}),
      ...(model ? { model } : {}),
      apiKeyConfigured: Boolean(apiKey),
      missingKeys,
    };
  }

  return {
    enabled: true,
    reason: 'configured',
    ...(providerName ? { providerName } : {}),
    model: model!,
    apiKeyConfigured: Boolean(apiKey),
    missingKeys: [],
  };
}

export function formatLlmProviderEnvSummary(summary: LlmProviderEnvSummary): string {
  if (!summary.enabled) return `disabled (${summary.reason})`;
  const provider = summary.providerName ? `provider=${summary.providerName}, ` : '';
  return `enabled (${provider}model=${summary.model}, apiKey=${summary.apiKeyConfigured ? 'set' : 'not set'})`;
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
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: OpenAiCompatibleLlmProviderConfig) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async generateJson(input: LlmGenerateJsonInput): Promise<LlmProviderResult> {
    const controller = new AbortController();
    let didTimeout = false;
    const timeout = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(chatCompletionsUrl(this.baseUrl), {
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
        signal: controller.signal,
      });
    } catch (error) {
      if (didTimeout) throw new Error(`LLM provider request timed out after ${this.timeoutMs}ms`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) throw new Error(`LLM provider request failed: ${response.status}`);
    const payload: unknown = await response.json();
    if (!isChatCompletionResponse(payload)) throw new Error('LLM response must be an object');
    const text = payload.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('LLM provider response missing message content');
    return { text, json: parseLlmJsonObject(text), model: this.model };
  }
}

export function createLlmProviderFromEnv(env: OpenAiCompatibleLlmEnv = process.env, fetchImpl: typeof fetch = fetch): LlmProvider | null {
  const providerName = envValue(env, 'MT_AGENT_LLM_PROVIDER', 'LLM_PROVIDER');
  if (providerName === 'disabled') return null;
  const baseUrl = envValue(env, 'MT_AGENT_LLM_BASE_URL', 'LLM_BASE_URL');
  const model = envValue(env, 'MT_AGENT_LLM_MODEL', 'LLM_MODEL');
  if (!baseUrl || !model) return null;
  const apiKey = envValue(env, 'MT_AGENT_LLM_API_KEY', 'LLM_API_KEY');
  const timeoutMs = positiveInteger(envValue(env, 'MT_AGENT_LLM_TIMEOUT_MS', 'LLM_TIMEOUT_MS'));
  return new OpenAiCompatibleLlmProvider({ baseUrl, model, apiKey, ...(timeoutMs ? { timeoutMs } : {}), fetchImpl });
}

export function createOpenAiCompatibleProviderFromEnv(env: OpenAiCompatibleLlmEnv = process.env): OpenAiCompatibleLlmProvider | null {
  const baseUrl = normalized(env.LLM_BASE_URL);
  const apiKey = normalized(env.LLM_API_KEY);
  const model = normalized(env.LLM_MODEL);
  if (!baseUrl || !apiKey || !model) return null;
  return new OpenAiCompatibleLlmProvider({ baseUrl, apiKey, model });
}
