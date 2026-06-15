import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('LLM provider type source', () => {
  it('exports the provider contract types', () => {
    const source = readFileSync('src/llm/provider.ts', 'utf8');
    expect(source).toContain('export type LlmRole');
    expect(source).toContain('export interface LlmChatMessage');
    expect(source).toContain('export interface LlmGenerateJsonInput');
    expect(source).toContain('export interface LlmProviderResult');
    expect(source).toContain('export interface LlmProvider');
    expect(source).toContain('generateJson(input: LlmGenerateJsonInput): Promise<LlmProviderResult>');
  });
});
