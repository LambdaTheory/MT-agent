import { buildAgentToolConfirmValue, type AgentToolConfirmRequest } from '../agentRuntime/approvalCard.js';
import type { FeishuCardPayload } from '../notify/feishuApp.js';

export interface RefreshActivityStrategyCardInput {
  date: string;
  delistOnlyRequest: AgentToolConfirmRequest;
  delistAndRefillRequest?: AgentToolConfirmRequest;
  skippedGroups: string[];
}

export function buildRefreshActivityStrategyCard(input: RefreshActivityStrategyCardInput): FeishuCardPayload {
  const infoLines = [
    `**请选择 ${input.date} 活跃度刷新执行策略**`,
    '确认前不会下架或补链。',
    input.skippedGroups.length ? `下架+补链将跳过以下无安全源组：${input.skippedGroups.join('、')}` : undefined,
  ].filter((line): line is string => Boolean(line)).join('\n');

  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: '活跃度刷新策略选择' }, template: 'orange' },
    body: {
      elements: [
        {
          tag: 'form',
          name: 'refresh_activity_strategy_form',
          elements: [
            {
              tag: 'markdown',
              content: infoLines,
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '只下架' },
              type: 'default',
              form_action_type: 'submit',
              name: 'refresh_activity_delist_only_submit',
              behaviors: [{ type: 'callback', value: buildAgentToolConfirmValue(input.delistOnlyRequest) }],
            },
            ...(input.delistAndRefillRequest ? [{
              tag: 'button',
              text: { tag: 'plain_text', content: '下架+补链' },
              type: 'primary',
              form_action_type: 'submit',
              name: 'refresh_activity_delist_refill_submit',
              behaviors: [{ type: 'callback', value: buildAgentToolConfirmValue(input.delistAndRefillRequest) }],
            }] : []),
          ],
        },
      ],
    },
  };
}
