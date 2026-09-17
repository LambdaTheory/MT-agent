import { describe, expect, it } from 'vitest';
import { parseLlmJsonObject } from '../src/llm/json.js';

describe('parseLlmJsonObject', () => {
  it('parses a bare JSON object', () => {
    expect(parseLlmJsonObject('{"tool":"get_latest_summary","confidence":0.9}')).toEqual({ tool: 'get_latest_summary', confidence: 0.9 });
  });

  it('rejects empty output', () => {
    expect(() => parseLlmJsonObject('  ')).toThrow('LLM output is empty');
  });

  it('strips a full markdown code fence around JSON (e.g. Gemini flash tends to add one despite instructions not to)', () => {
    expect(parseLlmJsonObject('```json\n{"tool":"x"}\n```')).toEqual({ tool: 'x' });
    expect(parseLlmJsonObject('```\n{"tool":"x"}\n```')).toEqual({ tool: 'x' });
  });

  it('still fails loudly on a partial/unbalanced fence', () => {
    expect(() => parseLlmJsonObject('```json\n{"tool":"x"}')).toThrow('Invalid LLM JSON output');
  });

  it('rejects non-object JSON values', () => {
    expect(() => parseLlmJsonObject('[{"tool":"x"}]')).toThrow('LLM JSON output must be an object');
    expect(() => parseLlmJsonObject('null')).toThrow('LLM JSON output must be an object');
    expect(() => parseLlmJsonObject('"text"')).toThrow('LLM JSON output must be an object');
  });

  it('rejects invalid JSON', () => {
    expect(() => parseLlmJsonObject('{tool:x}')).toThrow('Invalid LLM JSON output');
  });
});
