import { describe, expect, it, vi } from 'vitest';
import { createLlmProviderFromEnv, createOpenAiCompatibleProviderFromEnv, OpenAiCompatibleLlmProvider } from '../src/llm/openAiCompatibleProvider.js';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('OpenAiCompatibleLlmProvider', () => {
  it('posts chat completion request and parses JSON content', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        choices: [{ message: { content: '{"tool":"get_latest_summary","confidence":0.88}' } }],
      }),
    ) as unknown as typeof fetch;
    const provider = new OpenAiCompatibleLlmProvider({ baseUrl: 'https://llm.example/v1', apiKey: 'secret', model: 'test-model', fetchImpl });

    const result = await provider.generateJson({ messages: [{ role: 'user', content: '今天怎么样' }], temperature: 0.1 });

    expect(result.json).toEqual({ tool: 'get_latest_summary', confidence: 0.88 });
    expect(result.model).toBe('test-model');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://llm.example/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer secret', 'Content-Type': 'application/json' }),
        body: JSON.stringify({ model: 'test-model', messages: [{ role: 'user', content: '今天怎么样' }], temperature: 0.1 }),
      }),
    );
  });

  it('throws on HTTP errors', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad gateway', { status: 502 })) as unknown as typeof fetch;
    const provider = new OpenAiCompatibleLlmProvider({ baseUrl: 'https://llm.example/v1', apiKey: 'secret', model: 'test-model', fetchImpl });

    await expect(provider.generateJson({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow('LLM provider request failed: 502');
  });

  it('throws when response content is missing', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: {} }] })) as unknown as typeof fetch;
    const provider = new OpenAiCompatibleLlmProvider({ baseUrl: 'https://llm.example/v1', apiKey: 'secret', model: 'test-model', fetchImpl });

    await expect(provider.generateJson({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow('LLM provider response missing message content');
  });

  it('creates provider from legacy env and returns null when config is missing', () => {
    expect(createOpenAiCompatibleProviderFromEnv({ LLM_BASE_URL: 'https://llm.example/v1', LLM_API_KEY: 'secret', LLM_MODEL: 'test-model' })).toBeInstanceOf(OpenAiCompatibleLlmProvider);
    expect(createOpenAiCompatibleProviderFromEnv({ LLM_BASE_URL: 'https://llm.example/v1', LLM_API_KEY: '', LLM_MODEL: 'test-model' })).toBeNull();
  });

  it('creates the MVP provider from MT_AGENT_LLM_* env and an injectable fetch implementation', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      return jsonResponse({ choices: [{ message: { content: '{"tool":"get_latest_summary"}' } }], model: 'demo-model' });
    };

    const provider = createLlmProviderFromEnv({ MT_AGENT_LLM_BASE_URL: 'https://llm.example/v1', MT_AGENT_LLM_API_KEY: 'secret', MT_AGENT_LLM_MODEL: 'demo-model' }, fetchImpl);

    await expect(provider?.generateJson({ messages: [{ role: 'user', content: 'select tool' }], temperature: 0 })).resolves.toMatchObject({ text: '{"tool":"get_latest_summary"}', json: { tool: 'get_latest_summary' }, model: 'demo-model' });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://llm.example/v1/chat/completions');
    expect(requests[0].init.method).toBe('POST');
    expect((requests[0].init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    expect(JSON.parse(String(requests[0].init.body))).toMatchObject({ model: 'demo-model', temperature: 0, messages: [{ role: 'user', content: 'select tool' }] });
  });

  it('returns null when required MVP LLM configuration is missing', () => {
    expect(createLlmProviderFromEnv({})).toBeNull();
  });

  it('keeps the MVP provider disabled when LLM_PROVIDER is disabled', () => {
    expect(createLlmProviderFromEnv({ LLM_PROVIDER: 'disabled', LLM_BASE_URL: 'https://llm.example/v1', LLM_MODEL: 'test-model' })).toBeNull();
  });
});
