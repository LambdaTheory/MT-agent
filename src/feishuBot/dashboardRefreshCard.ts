import type { PeriodKey } from '../domain/types.js';
import type { FeishuCardPayload } from '../notify/feishuApp.js';
import { formatDashboardQuality } from '../publicTraffic/dashboardQuality.js';
import type { DashboardRefreshResult, DashboardRefreshStatus } from '../publicTraffic/dashboardRefresh.js';

const PERIODS: readonly PeriodKey[] = ['1d', '7d', '30d'];
const PERIOD_LABELS: Record<PeriodKey, string> = {
  '1d': '1日',
  '7d': '7日',
  '30d': '30日',
};

const STATUS_META: Record<DashboardRefreshStatus, { title: string; template: 'green' | 'orange' | 'blue' }> = {
  repaired: { title: '访问页补抓并重建完成', template: 'green' },
  still_missing: { title: '访问页补抓完成，但数据仍未完整', template: 'orange' },
  saved_existing_complete: { title: '访问页数据已保存', template: 'blue' },
  saved_already_resent: { title: '访问页数据已保存', template: 'blue' },
  saved_historical_without_report: { title: '历史访问页 raw 已归档', template: 'blue' },
};

function reportAction(result: DashboardRefreshResult): string {
  if (result.rebuild === 'performed' && result.resend === 'performed') return '日报处理：已重建，已重发 1 次';
  if (result.rebuild === 'performed') return '日报处理：已重建，未重发';
  if (result.status === 'saved_already_resent') return '日报处理：已跳过重复重发';
  return '日报处理：未重建、未重发';
}

function statusExplanation(result: DashboardRefreshResult): string {
  if (result.status === 'still_missing') return '任一周期缺失，补抓已安全结束，未重建或重发日报。';
  if (result.status === 'saved_historical_without_report') return '未找到该业务数据日的既有日报上下文，仅归档 raw。';
  return result.message;
}

function periodRows(result: DashboardRefreshResult): string[] {
  return PERIODS.map((period) => {
    const quality = result.refreshQuality.periods[period];
    const state = quality.complete ? '完整' : '缺失';
    const reason = quality.complete ? '' : `（${quality.reason ?? 'unknown'}）`;
    return `| ${PERIOD_LABELS[period]} | ${state} | ${quality.rowCount} | ${reason || '-'} |`;
  });
}

export function formatDashboardRefreshResultText(result: DashboardRefreshResult): string {
  const meta = STATUS_META[result.status];
  return [
    meta.title,
    `业务数据日：${result.dataDate}`,
    `页面回读：${result.actualPageDate}`,
    '| 周期 | 状态 | 行数 | 原因 |',
    '| --- | --- | ---: | --- |',
    ...periodRows(result),
    reportAction(result),
    statusExplanation(result),
    `rawLocation：${result.rawLocation}`,
    `质量摘要：${formatDashboardQuality(result.refreshQuality)}`,
  ].join('\n');
}

export function buildDashboardRefreshResultCard(result: DashboardRefreshResult): FeishuCardPayload {
  const meta = STATUS_META[result.status];
  return {
    schema: '2.0',
    header: {
      title: { tag: 'plain_text', content: meta.title },
      template: meta.template,
    },
    body: {
      elements: [{ tag: 'markdown', content: formatDashboardRefreshResultText(result) }],
    },
  };
}
