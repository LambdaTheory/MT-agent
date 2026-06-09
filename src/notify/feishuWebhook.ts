import type { DailyReportData, ProductAnalysisRow } from '../domain/types.js';

export interface FeishuReportPaths {
  markdownPath: string;
  workbookPath: string;
}

export type FeishuSendResult = { sent: true } | { sent: false; reason: string };

function countUnmapped(data: DailyReportData): number {
  return data.analysisRows.filter((row) => row.mappingStatus !== 'mapped').length;
}

function identifier(row: ProductAnalysisRow): string {
  if (row.mappingStatus === 'mapped' && row.internalProductId) {
    return `端内ID ${row.internalProductId}`;
  }

  return `平台商品ID ${row.platformProductId}`;
}

function candidateLine(row: ProductAnalysisRow): string {
  return `${identifier(row)}：建议动作=${row.action}。原因：${row.reason}`;
}

function ids(rows: ProductAnalysisRow[], limit = 6): string {
  if (rows.length === 0) {
    return '无';
  }

  const values = rows.slice(0, limit).map(identifier);
  return rows.length > limit ? `${values.join('、')} 等${rows.length}个` : values.join('、');
}

function metricLine(row: ProductAnalysisRow): string {
  const seven = row.metrics['7d'];
  const thirty = row.metrics['30d'];
  return `7天访问 ${seven?.visits ?? 0}，发货 ${seven?.shippedOrders ?? 0}；30天访问 ${thirty?.visits ?? 0}，发货 ${thirty?.shippedOrders ?? 0}`;
}

function suggestedOperation(row: ProductAnalysisRow): string {
  if (row.action === '疑似价格问题' || row.action === '高曝光低转化') {
    return '检查价格、库存、履约竞争力';
  }

  if (row.action === '建议补链') {
    return '补同款链接或加曝光';
  }

  if (row.action === '建议加曝光') {
    return '增加曝光';
  }

  if (row.action === '疑似失活') {
    return '排查链接、库存或页面问题';
  }

  return '继续观察';
}

export function buildFeishuReportText(data: DailyReportData, paths: FeishuReportPaths): string {
  const priorityRows = data.analysisRows.filter((row) => row.action === '疑似价格问题' || row.action === '高曝光低转化');
  const opportunityRows = data.analysisRows.filter((row) => row.action === '建议补链' || row.action === '建议加曝光');
  const inactiveRows = data.analysisRows.filter((row) => row.action === '疑似失活');
  const reviewRows = data.analysisRows.filter((row) => row.action === '继续观察' && row.confidence !== '低');
  const keyRows = [...priorityRows, ...opportunityRows, ...inactiveRows].slice(0, 5);
  const lines = [
    `MT运营日报 ${data.date}`,
    '',
    '今日结论',
    `高优先级：${priorityRows.length}个`,
    `增长机会：${opportunityRows.length}个`,
    `需人工复核：${reviewRows.length + inactiveRows.length}个`,
    `未映射ID：${countUnmapped(data)}个`,
    `抓取状态：${data.incomplete ? '存在不完整周期' : '完整'}`,
    '',
    '拟执行运营操作',
    `1. 查价/调价：${ids(priorityRows)}`,
    '   原因：有订单信号但近7天无发货，或高曝光低转化',
    '',
    `2. 补链/加曝光：${ids(opportunityRows)}`,
    '   原因：低曝光已有发货信号，或转化表现可用',
    '',
    `3. 排查失活：${ids(inactiveRows)}`,
    '   原因：30天高访问但无发货',
    '',
    '重点商品',
    ...(keyRows.length > 0
      ? keyRows.flatMap((row, index) => [`${index + 1}. ${identifier(row)}｜${row.action}`, `   ${metricLine(row)}`, `   建议：${suggestedOperation(row)}`])
      : ['无']),
    '',
    '报告文件',
    `Markdown：${paths.markdownPath}`,
    `XLSX：${paths.workbookPath}`,
  ];

  return lines.join('\n');
}

export function buildFeishuTestText(): string {
  return [`MT-agent 飞书连通测试`, `时间：${new Date().toISOString()}`, '如果你看到这条消息，说明 MT-agent 已经能发送飞书消息。'].join('\n');
}

export async function sendFeishuWebhookText(webhookUrl: string | undefined, text: string, fetchImpl: typeof fetch = fetch): Promise<FeishuSendResult> {
  if (!webhookUrl) {
    return { sent: false, reason: 'missing webhook url' };
  }

  const response = await fetchImpl(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msg_type: 'text',
      content: { text },
    }),
  });

  if (!response.ok) {
    return { sent: false, reason: `http ${response.status}: ${await response.text()}` };
  }

  return { sent: true };
}

export async function maybeSendFeishuReport(
  webhookUrl: string | undefined,
  data: DailyReportData,
  paths: FeishuReportPaths,
  fetchImpl: typeof fetch = fetch,
): Promise<FeishuSendResult> {
  return sendFeishuWebhookText(webhookUrl, buildFeishuReportText(data, paths), fetchImpl);
}

export async function maybeSendFeishuTestMessage(webhookUrl: string | undefined, fetchImpl: typeof fetch = fetch): Promise<FeishuSendResult> {
  return sendFeishuWebhookText(webhookUrl, buildFeishuTestText(), fetchImpl);
}
