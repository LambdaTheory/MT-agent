import { describe, expect, it, vi } from 'vitest';
import { createAgentRuntime } from '../src/agentRuntime/runtime.js';
import type { BotIntent } from '../src/feishuBot/types.js';

describe('createAgentRuntime', () => {
  it('passes request text through the injected resolver and handler', async () => {
    const resolvedIntent: BotIntent = { type: 'latest_summary' };
    const resolveIntent = vi.fn((text: string): BotIntent => text === '今日概况' ? resolvedIntent : { type: 'unknown', text });
    const handleIntent = vi.fn(async (intent: BotIntent, outputDir?: string) => ({
      text: `handled:${intent.type}:${outputDir}`,
    }));
    const runtime = createAgentRuntime({ outputDir: 'tmp/runtime-output', resolveIntent, handleIntent });

    await expect(runtime.handle({ source: 'feishu', text: '今日概况' })).resolves.toEqual({ text: 'handled:latest_summary:tmp/runtime-output' });
    expect(resolveIntent).toHaveBeenCalledWith('今日概况');
    expect(handleIntent).toHaveBeenCalledWith(resolvedIntent, 'tmp/runtime-output', expect.objectContaining({
      auditContext: expect.objectContaining({ source: 'feishu', actorAvailable: false }),
      activateAudit: expect.any(Function),
    }));
  });

  it('uses the existing deterministic parser when no resolver is injected', async () => {
    const handledIntents: BotIntent[] = [];
    const runtime = createAgentRuntime({
      handleIntent: async (intent) => {
        handledIntents.push(intent);
        return { text: intent.type };
      },
    });

    await expect(runtime.handle({ source: 'api', text: '查询 565' })).resolves.toEqual({ text: 'query_product' });
    expect(handledIntents).toEqual([{ type: 'query_product', keyword: '565' }]);
  });

  it('keeps product queries local-direct when an agent planner is configured', async () => {
    const handledIntents: BotIntent[] = [];
    const runtime = createAgentRuntime({
      agentPlannerProvider: { async proposePlan() { return '{}'; } },
      handleIntent: async (intent) => {
        handledIntents.push(intent);
        return { text: intent.type };
      },
    });

    await expect(runtime.handle({ source: 'api', text: '查询 565' })).resolves.toEqual({ text: 'query_product' });
    expect(handledIntents).toEqual([{ type: 'query_product', keyword: '565' }]);
  });

  it('preserves request metadata without requiring adapter-specific fields', async () => {
    const handleIntent = vi.fn(async (intent: BotIntent) => ({ text: intent.type }));
    const runtime = createAgentRuntime({
      resolveIntent: (text) => ({ type: 'unknown', text }),
      handleIntent,
    });

    await expect(runtime.handle({
      source: 'scheduler',
      text: '计划任务',
      actor: { id: 'system' },
      channel: { type: 'unknown' },
      metadata: { jobId: 'daily-check' },
    })).resolves.toEqual({ text: 'unknown' });
    expect(handleIntent).toHaveBeenCalledWith({ type: 'unknown', text: '计划任务' }, undefined, expect.objectContaining({
      auditContext: expect.objectContaining({ source: 'scheduler', rawActorId: 'system', channel: 'scheduler' }),
      activateAudit: expect.any(Function),
    }));
  });
});
