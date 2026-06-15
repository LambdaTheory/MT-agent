import { describe, expect, it, vi } from 'vitest';
import { createOpenAiCompatibleProviderFromEnv, OpenAiCompatibleLlmProvider } from '../src/llm/openAiCompatibleProvider.js';

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

  it('creates provider from complete env and returns null when config is missing', () => {
    expect(createOpenAiCompatibleProviderFromEnv({ LLM_BASE_URL: 'https://llm.example/v1', LLM_API_KEY: 'secret', LLM_MODEL: 'test-model' })).toBeInstanceOf(OpenAiCompatibleLlmProvider);
    expect(createOpenAiCompatibleProviderFromEnv({ LLM_BASE_URL: 'https://llm.example/v1', LLM_API_KEY: '', LLM_MODEL: 'test-model' })).toBeNull();
  });
});
