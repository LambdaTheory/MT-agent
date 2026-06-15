import { parseLlmJsonObject } from './json.js';
import type { LlmGenerateJsonInput, LlmProvider, LlmProviderResult } from './provider.js';

export interface OpenAiCompatibleLlmProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function stringValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export class OpenAiCompatibleLlmProvider implements LlmProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: OpenAiCompatibleLlmProviderConfig) {
    this.baseUrl = trimTrailingSlash(config.baseUrl);
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async generateJson(input: LlmGenerateJsonInput): Promise<LlmProviderResult> {
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: input.messages,
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
        ...(input.maxTokens !== undefined ? { max_tokens: input.maxTokens } : {}),
      }),
    });

    if (!response.ok) throw new Error(`LLM provider request failed: ${response.status}`);
    const parsed = (await response.json()) as ChatCompletionResponse;
    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('LLM provider response missing message content');
    return { text: content, json: parseLlmJsonObject(content), model: this.model };
  }
}

export function createOpenAiCompatibleProviderFromEnv(env: Partial<NodeJS.ProcessEnv> = process.env): OpenAiCompatibleLlmProvider | null {
  const baseUrl = stringValue(env.LLM_BASE_URL);
  const apiKey = stringValue(env.LLM_API_KEY);
  const model = stringValue(env.LLM_MODEL);
  if (!baseUrl || !apiKey || !model) return null;
  return new OpenAiCompatibleLlmProvider({ baseUrl, apiKey, model });
}
