import { buildAgentToolConfirmCard, type AgentToolConfirmRequest } from '../agentRuntime/approvalCard.js';
import type { FeishuCardPayload } from '../notify/feishuApp.js';

export interface RefreshActivityStrategyCardInput {
  date: string;
  planRef: string;
  confirmationKeyDelistOnly: string;
  confirmationKeyDelistAndRefill?: string;
  delistCount: number;
  newLinkCount: number;
  skippedGroups: string[];
}

function buildStrategySelectValue(
  input: Pick<RefreshActivityStrategyCardInput, 'planRef'>,
  strategy: 'delist_only' | 'delist_and_refill',
  confirmationKey: string,
): { action: 'refresh_activity_strategy_select'; planRef: string; strategy: 'delist_only' | 'delist_and_refill'; confirmationKey: string } {
  return { action: 'refresh_activity_strategy_select', planRef: input.planRef, strategy, confirmationKey };
}

export function buildRefreshActivityStrategyCard(input: RefreshActivityStrategyCardInput): FeishuCardPayload {
  const infoLines = [
    `**请选择 ${input.date} 活跃度刷新执行策略**`,
    '确认前不会下架或补链。',
    `待下架：${input.delistCount} 条。`,
    input.confirmationKeyDelistAndRefill ? `下架+补链：预计补链 ${input.newLinkCount} 条。` : undefined,
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
              behaviors: [{ type: 'callback', value: buildStrategySelectValue(input, 'delist_only', input.confirmationKeyDelistOnly) }],
            },
            ...(input.confirmationKeyDelistAndRefill ? [{
              tag: 'button',
              text: { tag: 'plain_text', content: '下架+补链' },
              type: 'primary',
              form_action_type: 'submit',
              name: 'refresh_activity_delist_refill_submit',
              behaviors: [{ type: 'callback', value: buildStrategySelectValue(input, 'delist_and_refill', input.confirmationKeyDelistAndRefill) }],
            }] : []),
          ],
        },
      ],
    },
  };
}

export function buildRefreshActivityExecuteConfirmCard(
  request: AgentToolConfirmRequest,
  requestRef: string,
  details: { delistProductIds: string[]; newLinkSummary: string; skippedGroups: string[] },
): FeishuCardPayload {
  const card = buildAgentToolConfirmCard(request, { requestRef });
  const summary = [
    `**请确认活跃度刷新执行内容**`,
    `即将下架端内ID：${details.delistProductIds.join('、')}`,
    details.newLinkSummary ? `补链详情：${details.newLinkSummary}` : '补链详情：本次只下架，不补链',
    details.skippedGroups.length ? `跳过组：${details.skippedGroups.join('、')}` : undefined,
  ].filter((line): line is string => Boolean(line)).join('\n');
  const body = card.body as { elements: unknown[] };
  return {
    ...card,
    header: { title: { tag: 'plain_text', content: '活跃度刷新执行确认' }, template: 'orange' },
    body: {
      elements: [
        { tag: 'markdown', content: summary },
        ...body.elements,
      ],
    },
  };
}
