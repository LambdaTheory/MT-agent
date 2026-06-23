import { describe, expect, it } from 'vitest';
import { parseLlmJsonObject } from '../src/llm/json.js';

describe('parseLlmJsonObject', () => {
  it('parses a bare JSON object', () => {
    expect(parseLlmJsonObject('{"tool":"get_latest_summary","confidence":0.9}')).toEqual({ tool: 'get_latest_summary', confidence: 0.9 });
  });

  it('rejects empty output', () => {
    expect(() => parseLlmJsonObject('  ')).toThrow('LLM output is empty');
  });

  it('rejects markdown fenced JSON', () => {
    expect(() => parseLlmJsonObject('```json\n{"tool":"x"}\n```')).toThrow('LLM output must be a bare JSON object');
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
