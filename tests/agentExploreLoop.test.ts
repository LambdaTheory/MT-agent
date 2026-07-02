import { describe, expect, it } from 'vitest';
import { runAgentExploreLoop, type ExploreTool } from '../src/agentRuntime/agentExploreLoop.js';
import type { LlmGenerateJsonInput, LlmProvider, LlmProviderResult } from '../src/llm/provider.js';

class ScriptedProvider implements LlmProvider {
  private index = 0;

  constructor(private readonly scripts: string[]) {}

  async generateJson(_input: LlmGenerateJsonInput): Promise<LlmProviderResult> {
    const text = this.scripts[Math.min(this.index++, this.scripts.length - 1)];
    return { text, json: JSON.parse(text), model: 'fake' };
  }
}

const tools: ExploreTool[] = [
  { name: 'read', description: '读商品', run: async (args) => ({ productId: args.productId, exposure: 100 }) },
];

describe('runAgentExploreLoop', () => {
  it('calls a tool then finishes with an answer', async () => {
    const provider = new ScriptedProvider([
      JSON.stringify({ action: 'call_tool', tool: 'read', args: { productId: '648' } }),
      JSON.stringify({ action: 'finish', answer: '648 曝光 100' }),
    ]);

    const result = await runAgentExploreLoop({ provider, instruction: '查648曝光', tools });

    expect(result.stopReason).toBe('answered');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ tool: 'read', args: { productId: '648' }, result: { productId: '648', exposure: 100 } });
    expect(result.answer).toContain('100');
  });

  it('stops at maxSteps if the model never finishes', async () => {
    const provider = new ScriptedProvider([
      JSON.stringify({ action: 'call_tool', tool: 'read', args: { productId: '648' } }),
    ]);

    const result = await runAgentExploreLoop({ provider, instruction: 'loop', tools, maxSteps: 3 });

    expect(result.stopReason).toBe('max_steps');
    expect(result.steps).toHaveLength(3);
  });

  it('stops as invalid when the model requests an unknown tool', async () => {
    const provider = new ScriptedProvider([
      JSON.stringify({ action: 'call_tool', tool: 'nope', args: {} }),
    ]);

    const result = await runAgentExploreLoop({ provider, instruction: 'x', tools });

    expect(result.stopReason).toBe('invalid');
    expect(result.steps).toHaveLength(0);
  });
});
