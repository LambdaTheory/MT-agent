import { describe, expect, it } from 'vitest';
import { runAgentExploreLoop, type ExploreTool } from '../src/agentRuntime/agentExploreLoop.js';
import { FakeLlmProvider } from '../src/llm/fakeProvider.js';

const tools: ExploreTool[] = [
  { name: 'read', description: '读商品', run: async (args) => ({ productId: args.productId, exposure: 100 }) },
];

describe('runAgentExploreLoop', () => {
  it('calls a tool then finishes with an answer', async () => {
    const provider = new FakeLlmProvider([
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
    const provider = new FakeLlmProvider([
      JSON.stringify({ action: 'call_tool', tool: 'read', args: { productId: '648' } }),
    ]);

    const result = await runAgentExploreLoop({ provider, instruction: 'loop', tools, maxSteps: 3 });

    expect(result.stopReason).toBe('max_steps');
    expect(result.steps).toHaveLength(3);
  });

  it('stops as invalid when the model requests an unknown tool', async () => {
    const provider = new FakeLlmProvider([
      JSON.stringify({ action: 'call_tool', tool: 'nope', args: {} }),
    ]);

    const result = await runAgentExploreLoop({ provider, instruction: 'x', tools });

    expect(result.stopReason).toBe('invalid');
    expect(result.steps).toHaveLength(0);
  });

  it('stops as invalid when a tool rejects model-produced arguments', async () => {
    const provider = new FakeLlmProvider([
      JSON.stringify({ action: 'call_tool', tool: 'read', args: { productId: 'bad' } }),
    ]);
    const throwingTools: ExploreTool[] = [
      { name: 'read', description: '读商品', run: async () => { throw new Error('invalid product id'); } },
    ];

    const result = await runAgentExploreLoop({ provider, instruction: '查bad曝光', tools: throwingTools });

    expect(result.stopReason).toBe('invalid');
    expect(result.steps).toHaveLength(0);
  });
});
