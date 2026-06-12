import { runPublicTrafficReportCli } from '../cli/publicTrafficReport.js';
import { sendFeishuCard } from '../notify/feishu.js';
import { parseAgentDataIntent } from '../agentData/intent.js';
import { getProblemProducts } from '../agentData/publicTrafficQueries.js';
import { buildAgentTaskPool } from '../agentData/taskPool.js';
import { buildPublicTrafficCard } from '../publicTraffic/buildPublicTrafficCard.js';
import { buildPublicTrafficFeishuText } from '../publicTraffic/buildPublicTrafficFeishu.js';
import { findLatestReportContext, formatLatestSummary, formatProductRows, queryProductRows } from './reportStore.js';
import type { BotIntent, BotResponse } from './types.js';

let running = false;

function formatTaskLines(items: Array<{ productId: string; suggestedAction: string; reason: string }>): string {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item.productId}：${item.suggestedAction}。原因：${item.reason}`).join('\n') : '暂无待处理任务。';
}

function formatProblemLines(items: Array<{ productId: string; action: string; reason: string }>): string {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item.productId}：${item.action}。原因：${item.reason}`).join('\n') : '暂无匹配问题商品。';
}

export async function handleBotIntent(intent: BotIntent, outputDir = 'output'): Promise<BotResponse> {
  if (intent.type === 'help') {
    return { text: '可用命令：今日概况｜查询 565｜跑日报｜重发日报｜帮助' };
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
    if (dataIntent.type === 'tasks') {
      const latest = await findLatestReportContext(outputDir);
      return { text: latest ? formatTaskLines(buildAgentTaskPool(latest.context)) : '还没有找到公域日报上下文。' };
    }
    if (dataIntent.type === 'problem_products') {
      const latest = await findLatestReportContext(outputDir);
      return { text: latest ? formatProblemLines(getProblemProducts(latest.context, dataIntent.problemType)) : '还没有找到公域日报上下文。' };
    }
  }

  return { text: '暂时只支持：今日概况、查询 商品ID/名称、跑日报、重发日报、帮助。' };
}
