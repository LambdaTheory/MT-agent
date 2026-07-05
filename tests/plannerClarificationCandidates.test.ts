import { describe, expect, it } from 'vitest';
import { validateAgentPlannerClarificationProposal } from '../src/agentRuntime/planner.js';

describe('planner clarification candidates', () => {
  it('extracts valid tool candidates from clarification options', () => {
    const result = validateAgentPlannerClarificationProposal(JSON.stringify({
      goal: '澄清商品操作',
      needsClarification: true,
      originalMessage: '帮我处理 648',
      question: '你想怎么处理 648？',
      options: [
        {
          label: '查询 648',
          message: '查询 648 的表现',
          description: '只读查询',
          toolName: 'product.query',
          arguments: { keyword: '648' },
        },
        {
          label: '下架 648',
          message: '把 648 下架',
          description: '需要确认',
          toolName: 'rental.delist',
          arguments: { productId: '648' },
        },
      ],
      confidence: 0.42,
      reason: '动作不明确',
    }));

    expect(result).toMatchObject({
      ok: true,
      proposal: {
        candidates: [
          { toolName: 'product.query', arguments: { keyword: '648' }, label: '查询 648', description: '只读查询' },
          { toolName: 'rental.delist', arguments: { productId: '648' }, label: '下架 648', description: '需要确认' },
        ],
      },
    });
  });

  it('preserves invalid tool options as clarified-message candidates', () => {
    const result = validateAgentPlannerClarificationProposal(JSON.stringify({
      goal: '澄清商品操作',
      needsClarification: true,
      originalMessage: '帮我处理 648',
      question: '你想怎么处理 648？',
      options: [
        {
          label: '查询 648',
          message: '查询 648 的表现',
          toolName: 'product.query',
          arguments: { keyword: '648' },
        },
        {
          label: '错误工具',
          message: '走不存在的工具',
          toolName: 'missing.tool',
          arguments: {},
        },
        {
          label: '错误参数',
          message: '缺少查询参数',
          toolName: 'product.query',
          arguments: {},
        },
      ],
      confidence: 0.42,
      reason: '动作不明确',
    }));

    expect(result).toMatchObject({
      ok: true,
      proposal: {
        options: [
          { label: '查询 648', message: '查询 648 的表现' },
          { label: '错误工具', message: '走不存在的工具' },
          { label: '错误参数', message: '缺少查询参数' },
        ],
        candidates: [
          { toolName: 'product.query', arguments: { keyword: '648' }, label: '查询 648' },
          { toolName: 'agent.clarifiedMessage', arguments: { message: '走不存在的工具' }, label: '错误工具' },
          { toolName: 'agent.clarifiedMessage', arguments: { message: '缺少查询参数' }, label: '错误参数' },
        ],
      },
    });
  });
});
