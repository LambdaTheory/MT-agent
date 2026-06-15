import { runPublicTrafficReportCli } from '../cli/publicTrafficReport.js';
import { sendFeishuCard } from '../notify/feishu.js';
import { parseAgentDataIntent } from '../agentData/intent.js';
import { buildPublicTrafficCard } from '../publicTraffic/buildPublicTrafficCard.js';
import { buildPublicTrafficFeishuText } from '../publicTraffic/buildPublicTrafficFeishu.js';
import { findLatestReportContext, formatLatestSummary, formatProductRows, queryProductRows } from './reportStore.js';
import { findReadOnlyTool } from './readOnlyToolRegistry.js';
import type { BotIntent, BotResponse } from './types.js';

let running = false;

const UNKNOWN_GUIDANCE = '我现在可以查：今日概况、商品、新链接池、待处理任务、转化差、曝光低、高潜力、下架链接、订单情况。你可以问“新链接池怎么样”或“查一下721”。';

export async function handleBotIntent(intent: BotIntent, outputDir = 'output'): Promise<BotResponse> {
  if (intent.type === 'help') {
    return { text: '可用命令：今日概况｜查询 565｜跑日报｜重发日报｜推送日报到群｜帮助' };
  }

  if (intent.type === 'latest_summary') {
    const latest = await findLatestReportContext(outputDir);
    return { text: latest ? formatLatestSummary(latest.context) : '还没有找到公域日报上下文。' };
  }

  if (intent.type === 'query_product') {
    const latest = await findLatestReportContext(outputDir);
    return { text: latest ? formatProductRows(queryProductRows(latest.context, intent.keyword)) : '还没有找到公域日报上下文。' };
  }

  if (intent.type === 'run_public_traffic_report') {
    if (running) return { text: '公域日报正在运行中，请稍后再试。' };
    running = true;
    try {
      await runPublicTrafficReportCli();
      return { text: '公域日报已生成并发送。' };
    } finally {
      running = false;
    }
  }

  if (intent.type === 'push_latest_report_to_group') {
    const latest = await findLatestReportContext(outputDir);
    if (!latest) return { text: '还没有找到可推送的公域日报。' };
    const card = buildPublicTrafficCard(latest.context, { markdownPath: '', workbookPath: '' });
    const fallbackText = buildPublicTrafficFeishuText(latest.context, { markdownPath: '', workbookPath: '' });
    const result = await sendFeishuCard({ ...process.env, FEISHU_SEND_TO: 'group' }, card, fallbackText);
    return { text: result.sent ? '最新公域日报已推送到群。' : `公域日报推送到群失败：${result.reason}` };
  }

  if (intent.type === 'resend_latest_report') {
    const latest = await findLatestReportContext(outputDir);
    if (!latest) return { text: '还没有找到可重发的公域日报。' };
    const card = buildPublicTrafficCard(latest.context, { markdownPath: '', workbookPath: '' });
    const fallbackText = buildPublicTrafficFeishuText(latest.context, { markdownPath: '', workbookPath: '' });
    const env = intent.sendTo ? { ...process.env, FEISHU_SEND_TO: intent.sendTo } : process.env;
    const result = await sendFeishuCard(env, card, fallbackText);
    return { text: result.sent ? '最新公域日报已重发。' : `公域日报重发失败：${result.reason}` };
  }

  if (intent.type === 'unknown') {
    const dataIntent = parseAgentDataIntent(intent.text);
    const tool = findReadOnlyTool(dataIntent);
    if (!tool) return { text: UNKNOWN_GUIDANCE };

    const latest = await findLatestReportContext(outputDir);
    return latest ? tool.run(latest.context, dataIntent) : { text: '还没有找到公域日报上下文。' };
  }

  return { text: UNKNOWN_GUIDANCE };
}
