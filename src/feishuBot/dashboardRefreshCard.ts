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

const STATUS_META: Record<DashboardRefreshStatus, { title: string; template: 'green' | 'orange' | 'blue'; tag: string; tagColor: 'green' | 'orange' | 'blue' }> = {
  repaired: { title: '访问页补抓并重建完成', template: 'green', tag: '已修复', tagColor: 'green' },
  still_missing: { title: '访问页补抓完成，但数据仍未完整', template: 'orange', tag: '仍缺失', tagColor: 'orange' },
  saved_existing_complete: { title: '访问页数据已保存', template: 'blue', tag: '已保存', tagColor: 'blue' },
  saved_already_resent: { title: '访问页数据已保存', template: 'blue', tag: '已保存', tagColor: 'blue' },
  saved_historical_without_report: { title: '历史访问页 raw 已归档', template: 'blue', tag: '已归档', tagColor: 'blue' },
};

function markdown(content: string): Record<string, unknown> {
  return { tag: 'markdown', content };
}

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

function periodPill(result: DashboardRefreshResult, period: PeriodKey): string {
  const quality = result.refreshQuality.periods[period];
  const color = quality.complete ? 'green' : 'red';
  const state = quality.complete ? '完整' : `缺失${quality.reason ? `：${quality.reason}` : ''}`;
  return `<text_tag color='${color}'>${PERIOD_LABELS[period]} ${state} · ${quality.rowCount} 行</text_tag>`;
}

function dateColumn(label: string, value: string, color: 'blue' | 'green' | 'grey' = 'blue'): Record<string, unknown> {
  return {
    tag: 'column',
    width: 'weighted',
    weight: 1,
    vertical_align: 'top',
    elements: [markdown(`<text_tag color='${color}'>${label}</text_tag>\n**${value}**`)],
  };
}

function summaryLine(result: DashboardRefreshResult): string {
  const meta = STATUS_META[result.status];
  if (result.status === 'still_missing') return `<text_tag color='${meta.tagColor}'>${meta.tag}</text_tag> 已保存本次抓取结果，但仍有周期不完整，未继续重建或重发。`;
  if (result.status === 'saved_historical_without_report') return `<text_tag color='${meta.tagColor}'>${meta.tag}</text_tag> 未匹配到既有日报，仅保存历史 raw 供后续人工使用。`;
  if (result.rebuild === 'performed' && result.resend === 'skipped') return `<text_tag color='${meta.tagColor}'>${meta.tag}</text_tag> 访问页 raw 已落盘，日报已本地重建，本次未重发飞书日报。`;
  if (result.status === 'saved_already_resent') return `<text_tag color='${meta.tagColor}'>${meta.tag}</text_tag> 访问页 raw 已落盘；该业务数据日此前已补抓重发过，本次跳过重复重发。`;
  return `<text_tag color='${meta.tagColor}'>${meta.tag}</text_tag> 访问页 raw 已落盘；既有日报无需自动重建或重发。`;
}

function buildDateColumns(result: DashboardRefreshResult): Record<string, unknown> {
  return {
    tag: 'column_set',
    flex_mode: 'bisect',
    horizontal_spacing: '8px',
    columns: [
      dateColumn('业务数据日', result.dataDate, 'blue'),
      dateColumn('页面回读日', result.actualPageDate, 'green'),
      ...(result.resolvedReportRunDate ? [dateColumn('日报目录日', result.resolvedReportRunDate, 'grey')] : []),
    ],
  };
}

function buildQualityBlock(result: DashboardRefreshResult): Record<string, unknown> {
  return markdown(`**三周期质量**\n${PERIODS.map((period) => periodPill(result, period)).join(' ')}`);
}

function buildActionBlock(result: DashboardRefreshResult): Record<string, unknown> {
  return markdown([
    `**处理动作**\n${reportAction(result)}`,
    `**raw 去向**\n${result.rawLocation}`,
    `<text_tag color='grey'>${statusExplanation(result)}</text_tag>`,
  ].join('\n\n'));
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
      elements: [
        markdown(summaryLine(result)),
        buildDateColumns(result),
        buildQualityBlock(result),
        buildActionBlock(result),
      ],
    },
  };
}
