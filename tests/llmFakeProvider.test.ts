import { describe, expect, it } from 'vitest';
import { FakeLlmProvider } from '../src/llm/fakeProvider.js';

describe('FakeLlmProvider', () => {
  it('returns fixed text as parsed JSON and records the latest input', async () => {
    const provider = new FakeLlmProvider('{"tool":"get_latest_summary","confidence":0.91}');
    const input = { messages: [{ role: 'user' as const, content: '今天怎么样' }], temperature: 0 };

    const result = await provider.generateJson(input);

    expect(result.text).toBe('{"tool":"get_latest_summary","confidence":0.91}');
    expect(result.json).toEqual({ tool: 'get_latest_summary', confidence: 0.91 });
    expect(result.model).toBe('fake');
    expect(provider.lastInput).toEqual(input);
  });
});
