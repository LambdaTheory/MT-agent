import type { FeishuCardPayload } from '../../notify/feishuApp.js';
import { inactiveRefreshPlanConfirmationKey } from './planStore.js';
import type { InactiveRefreshPlan, InactiveRefreshPlanSummary } from './types.js';

export function buildInactiveRefreshPlanCard(input: { plan: InactiveRefreshPlan; planRef: string; summary: InactiveRefreshPlanSummary; lines: string[] }): FeishuCardPayload {
  const value = {
    action: 'inactive_refresh_execute_select',
    planRef: input.planRef,
    confirmationKey: inactiveRefreshPlanConfirmationKey(input.plan),
  };
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: '失活刷新执行计划' }, template: 'orange' },
    body: {
      elements: [
        { tag: 'markdown', content: `**失活刷新执行计划**\n候选 ${input.summary.candidates} 条｜可执行 ${input.summary.executable} 条｜人工复核 ${input.summary.manualReview} 条｜排除 ${input.summary.excluded} 条` },
        { tag: 'markdown', content: input.lines.length ? input.lines.join('\n') : '没有可执行失活刷新项。' },
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '确认执行失活刷新' },
          type: 'primary',
          name: 'inactive_refresh_execute_submit',
          behaviors: [{ type: 'callback', value }],
        },
      ],
    },
  };
}
