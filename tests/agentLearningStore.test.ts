import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildAgentLearningPlannerHints,
  loadAgentLearningStore,
  recordAgentLearningEvent,
  summarizeAgentLearning,
} from '../src/agentLearning/store.js';

describe('agent learning store', () => {
  it('records clarification choices and returns planner hints for similar messages', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-learning-store-'));
    await recordAgentLearningEvent(outputDir, {
      type: 'clarification_selected',
      messageId: 'om-1',
      actorId: 'ou-1',
      originalMessage: '帮我处理一下 pocket3',
      selectedMessage: '帮我铺十条 pocket3 的新链',
      label: '铺新链',
      createdAt: '2026-06-23T01:00:00.000Z',
    });
    await recordAgentLearningEvent(outputDir, {
      type: 'clarification_selected',
      messageId: 'om-2',
      actorId: 'ou-1',
      originalMessage: '帮我处理一下 pocket3',
      selectedMessage: '帮我铺十条 pocket3 的新链',
      label: '铺新链',
      createdAt: '2026-06-23T02:00:00.000Z',
    });

    const hints = await buildAgentLearningPlannerHints(outputDir, '帮我处理 pocket3');

    expect(hints).toEqual([{
      originalMessage: '帮我处理一下 pocket3',
      selectedMessage: '帮我铺十条 pocket3 的新链',
      label: '铺新链',
      count: 2,
      confidence: expect.any(Number),
      lastSelectedAt: '2026-06-23T02:00:00.000Z',
    }]);
    expect(hints[0]?.confidence).toBeGreaterThan(0.7);
  });

  it('summarizes clarification and confirmation events', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-learning-summary-'));
    await recordAgentLearningEvent(outputDir, {
      type: 'clarification_selected',
      originalMessage: '帮我处理一下 875',
      selectedMessage: '复制商品 875',
      label: '复制商品',
    });
    await recordAgentLearningEvent(outputDir, {
      type: 'tool_confirmed',
      toolName: 'rental.operationConfirmRequest',
      arguments: { action: 'copy', productId: '875' },
    });
    await recordAgentLearningEvent(outputDir, {
      type: 'tool_completed',
      toolName: 'rental.operationConfirmRequest',
      resultSummary: '复制成功',
    });

    const summary = await summarizeAgentLearning(outputDir);
    const store = await loadAgentLearningStore(outputDir);
    const raw = await readFile(join(outputDir, 'state', 'agent-learning.json'), 'utf8');

    expect(summary).toContain('Agent 学习汇总');
    expect(summary).toContain('记录 3 条');
    expect(summary).toContain('澄清选择 1');
    expect(summary).toContain('工具确认 1，完成 1');
    expect(summary).toContain('帮我处理一下 875 -> 复制商品：复制商品 875');
    expect(store.events).toHaveLength(3);
    expect(raw).toContain('rental.operationConfirmRequest');
  });

  it('returns empty summary and no hints when there are no records', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-learning-empty-'));

    await expect(summarizeAgentLearning(outputDir)).resolves.toBe('还没有 Agent 学习记录。');
    await expect(buildAgentLearningPlannerHints(outputDir, '帮我处理一下 pocket3')).resolves.toEqual([]);
  });
  it('treats a corrupt learning store as empty instead of blocking Agent planning', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-learning-corrupt-'));
    await mkdir(join(outputDir, 'state'), { recursive: true });
    await writeFile(join(outputDir, 'state', 'agent-learning.json'), '{"version":1}\n{"broken":true}\n', 'utf8');

    await expect(loadAgentLearningStore(outputDir)).resolves.toMatchObject({ version: 1, events: [] });
    await expect(buildAgentLearningPlannerHints(outputDir, 'RX10M4整体价格 -1')).resolves.toEqual([]);
  });
});
