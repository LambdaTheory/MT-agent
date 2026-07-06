import { buildAgentToolConfirmValue, type AgentToolConfirmRequest } from '../agentRuntime/approvalCard.js';
import type { FeishuCardPayload } from '../notify/feishuApp.js';

export interface RefreshActivityStrategyCardInput {
  date: string;
  delistOnlyRequest: AgentToolConfirmRequest;
  delistAndRefillRequest?: AgentToolConfirmRequest;
  skippedGroups: string[];
}

function strategyForm(text: string, request: AgentToolConfirmRequest, formName: string): Record<string, unknown> {
  return {
    tag: 'form',
    name: formName,
    elements: [
      {
        tag: 'button',
        text: { tag: 'plain_text', content: text },
        type: text === '只下架' ? 'default' : 'primary',
        form_action_type: 'submit',
        name: 'agent_tool_confirm_submit',
        behaviors: [{ type: 'callback', value: buildAgentToolConfirmValue(request) }],
      },
    ],
  };
}

export function buildRefreshActivityStrategyCard(input: RefreshActivityStrategyCardInput): FeishuCardPayload {
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: '活跃度刷新策略选择' }, template: 'orange' },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: [
            `**请选择 ${input.date} 活跃度刷新执行策略**`,
            '确认前不会下架或补链。',
            input.skippedGroups.length ? `下架+补链将跳过 blocker：${input.skippedGroups.join('、')}` : undefined,
          ].filter((line): line is string => Boolean(line)).join('\n'),
        },
        strategyForm('只下架', input.delistOnlyRequest, 'refresh_activity_delist_only_form'),
        ...(input.delistAndRefillRequest ? [strategyForm('下架+补链', input.delistAndRefillRequest, 'refresh_activity_delist_refill_form')] : []),
      ],
    },
  };
}
