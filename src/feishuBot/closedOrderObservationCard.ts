import {
  closedOrderManualReviewReasonLabels,
  closedOrderReasonCountsText,
  closedOrderReasonTagLabel,
} from '../closedOrderFeedback/observation.js';
import type { ClosedOrderObservationGroup, ClosedOrderObservationReport } from '../closedOrderFeedback/types.js';
import type { FeishuCardPayload } from '../notify/feishuApp.js';

function markdown(content: string): Record<string, unknown> {
  return { tag: 'markdown', content };
}

function shortTime(value: string | null): string {
  if (!value) return '未知';
  return value.replace('T', ' ').replace('.000Z', 'Z');
}

function groupLine(group: ClosedOrderObservationGroup, index: number): string {
  const remark = group.sampleRemarks[0] ? `\n备注：${group.sampleRemarks[0]}` : '';
  return `${index + 1}. ${group.displayLabel}
记录 ${group.recordCount} | 主因 ${closedOrderReasonTagLabel(group.topReason)} | 最近 ${shortTime(group.latestClosedAt)}${remark}`;
}

function reviewLine(group: ClosedOrderObservationGroup): string {
  const reasons = closedOrderManualReviewReasonLabels(group.manualReviewReasons).join('、');
  return `- ${group.displayLabel}：${reasons}`;
}

export function buildClosedOrderObservationCard(report: ClosedOrderObservationReport): FeishuCardPayload {
  const topGroups = report.groups.slice(0, 5);
  const reviewGroups = report.groups.filter((group) => group.needsManualReview).slice(0, 5);
  const linkedRate = report.summary.recordCount > 0
    ? `${Math.round((report.summary.linkedRecordCount / report.summary.recordCount) * 100)}%`
    : '0%';
  const groupedRate = report.summary.recordCount > 0
    ? `${Math.round((report.summary.groupedRecordCount / report.summary.recordCount) * 100)}%`
    : '0%';

  return {
    schema: '2.0',
    header: {
      title: { tag: 'plain_text', content: `关单观察 ${report.date}` },
      template: reviewGroups.length > 0 ? 'orange' : 'green',
    },
    body: {
      elements: [
        markdown(`**近 ${report.windowDays} 天概览**
记录 ${report.summary.recordCount} | 今日 ${report.summary.todayRecordCount} | 分组 ${report.summary.groupCount} | 人工复核 ${report.summary.manualReviewGroupCount}`),
        markdown(`累计出现 ${report.summary.totalSeenCount} | link registry 命中率 ${linkedRate} | 同款分组命中率 ${groupedRate}`),
        markdown(`原因分布：${closedOrderReasonCountsText(report.summary.reasonCounts)}`),
        markdown(`**重点分组**
${topGroups.map((group, index) => groupLine(group, index)).join('\n\n') || '暂无重点分组'}`),
        markdown(`**人工复核**
${reviewGroups.map((group) => reviewLine(group)).join('\n') || '当前窗口内没有新增人工复核分组。'}`),
      ],
    },
  };
}
