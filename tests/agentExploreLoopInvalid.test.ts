import { describe, expect, it } from 'vitest';
import { runAgentExploreLoop, type ExploreTool } from '../src/agentRuntime/agentExploreLoop.js';
import type { LlmGenerateJsonInput, LlmProvider, LlmProviderResult } from '../src/llm/provider.js';

const tools: ExploreTool[] = [
  { name: 'read', description: '读商品', run: async (args) => ({ productId: args.productId, exposure: 100 }) },
];

class RawProvider implements LlmProvider {
  private index = 0;

  constructor(private readonly results: LlmProviderResult[]) {}

  async generateJson(_input: LlmGenerateJsonInput): Promise<LlmProviderResult> {
    return this.results[Math.min(this.index++, this.results.length - 1)]!;
  }
}

describe('runAgentExploreLoop invalid diagnostics', () => {
  it('returns invalid reason and raw first output when the first model action is not executable', async () => {
    const provider = new RawProvider([{ text: '我需要先看看数据', json: {} }]);

    const result = await runAgentExploreLoop({ provider, instruction: '查648曝光', tools });

    expect(result.stopReason).toBe('invalid');
    expect(result.invalidReason).toBe('non_json');
    expect(result.rawFirstOutput).toBe('我需要先看看数据');
    expect(result.steps).toHaveLength(0);
  });

  it('extracts fenced JSON from model text and continues executing read-only tools', async () => {
    const provider = new RawProvider([
      { text: '```json\n{"action":"call_tool","tool":"read","args":{"productId":"648"}}\n```', json: {} },
      { text: '{"action":"finish","answer":"648 曝光 100"}', json: { action: 'finish', answer: '648 曝光 100' } },
    ]);

    const result = await runAgentExploreLoop({ provider, instruction: '查648曝光', tools });

    expect(result.stopReason).toBe('answered');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ tool: 'read', args: { productId: '648' } });
    expect(result.answer).toContain('100');
  });
});
