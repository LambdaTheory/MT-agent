import { describe, expect, it } from 'vitest';
import { buildAgentToolConfirmCard, parseAgentToolConfirmRequest } from '../src/agentRuntime/approvalCard.js';
import { buildAgentClarificationCard, buildClarifiedMessage, parseAgentClarificationCustomSelection, parseAgentClarificationSelection } from '../src/agentRuntime/clarificationCard.js';

describe('agent runtime approval card', () => {
  it('builds a generic Feishu confirmation card for registered agent tools', () => {
    const card = buildAgentToolConfirmCard({
      toolName: 'rental.copy',
      arguments: { productId: '875' },
      reason: '用户希望复制商品 875',
    });

    expect(JSON.stringify(card)).toContain('Agent 操作确认');
    expect(JSON.stringify(card)).toContain('agent_tool_confirm');
    expect(JSON.stringify(card)).toContain('rental.copy');
    expect(JSON.stringify(card)).toContain('875');
  });

  it('parses only registered tools with schema-valid arguments', () => {
    expect(parseAgentToolConfirmRequest({
      request: {
        toolName: 'rental.delist',
        arguments: { productId: '761' },
        reason: '用户要求下架',
      },
    })).toEqual({
      toolName: 'rental.delist',
      arguments: { productId: '761' },
      reason: '用户要求下架',
    });

    expect(parseAgentToolConfirmRequest({
      request: {
        toolName: 'rental.operationConfirmRequest',
        arguments: { action: 'delist', productId: '761' },
        reason: '兼容升级前已发出的旧确认卡',
      },
    })).toEqual({
      toolName: 'rental.operationConfirmRequest',
      arguments: { action: 'delist', productId: '761' },
      reason: '兼容升级前已发出的旧确认卡',
    });

    expect(parseAgentToolConfirmRequest({
      request: {
        toolName: 'danger.deleteEverything',
        arguments: {},
        reason: 'bad',
      },
    })).toBeNull();

    expect(parseAgentToolConfirmRequest({
      request: {
        toolName: 'rental.operationConfirmRequest',
        arguments: { action: 'delist', productId: '761', script: 'evil' },
        reason: 'bad',
      },
    })).toBeNull();

    expect(parseAgentToolConfirmRequest({
      request: {
        toolName: 'rental.priceChange',
        arguments: { productId: '761', fields: 'rent1day=22' },
        reason: 'bad',
      },
    })).toBeNull();

    expect(parseAgentToolConfirmRequest({
      request: {
        toolName: 'rental.priceRollback',
        arguments: { taskId: 'task_1782451929574_977a5f62' },
        reason: '按审计任务回滚',
      },
    })).toEqual({
      toolName: 'rental.priceRollback',
      arguments: { taskId: 'task_1782451929574_977a5f62' },
      reason: '按审计任务回滚',
    });

    expect(parseAgentToolConfirmRequest({
      request: {
        toolName: 'rental.priceRollback',
        arguments: {},
        reason: 'bad',
      },
    })).toBeNull();
  });

  it('builds and parses a clarification card without executable tool payloads', () => {
    const card = buildAgentClarificationCard({
      originalMessage: '帮我处理一下 pocket3',
      question: '你想怎么处理 pocket3？',
      reason: '用户目标不明确，可能是查询、铺新链或改价。',
      options: [
        { label: '查询数据', message: '查询 pocket3 的公域数据', description: '只读查询' },
        { label: '铺新链', message: '帮我铺十条 pocket3 的新链', description: '需要二次确认' },
      ],
    });

    const raw = JSON.stringify(card);
    expect(raw).toContain('Agent 需要确认你的意图');
    expect(raw).toContain('custom_message');
    expect(raw).toContain('agent_clarify_custom');
    expect(raw).toContain('agent_clarify_select');
    expect(raw).toContain('帮我铺十条 pocket3 的新链');
    expect(raw).not.toContain('selectedTool');

    expect(parseAgentClarificationSelection({
      action: 'agent_clarify_select',
      originalMessage: '帮我处理一下 pocket3',
      selectedMessage: '帮我铺十条 pocket3 的新链',
      label: '铺新链',
    })).toEqual({
      originalMessage: '帮我处理一下 pocket3',
      selectedMessage: '帮我铺十条 pocket3 的新链',
      label: '铺新链',
    });

    expect(parseAgentClarificationSelection({
      action: 'agent_clarify_select',
      originalMessage: '帮我处理一下 pocket3',
      label: '铺新链',
    })).toBeNull();

    expect(parseAgentClarificationCustomSelection({
      action: 'agent_clarify_custom',
      originalMessage: '帮我处理一下 pocket3',
    }, '给 pocket3 铺 8 条新链')).toEqual({
      originalMessage: '帮我处理一下 pocket3',
      selectedMessage: '给 pocket3 铺 8 条新链',
      label: '自定义澄清',
    });

    expect(parseAgentClarificationCustomSelection({
      action: 'agent_clarify_custom',
      originalMessage: '帮我处理一下 pocket3',
    }, '')).toBeNull();

    expect(buildClarifiedMessage({
      originalMessage: '请回滚刚才的改价',
      selectedMessage: 'task_1782451929574_977a5f62',
      label: '自定义澄清',
    })).toContain('原始指令：请回滚刚才的改价');

    expect(buildClarifiedMessage({
      originalMessage: '帮我处理一下 875',
      selectedMessage: '复制商品 875',
      label: '自定义澄清',
    })).toBe('复制商品 875');
  });
});
