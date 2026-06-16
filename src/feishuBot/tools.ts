import { runPublicTrafficReportCli } from '../cli/publicTrafficReport.js';
import { sendFeishuCard } from '../notify/feishu.js';
import { parseAgentDataIntent } from '../agentData/intent.js';
import { buildPublicTrafficCard } from '../publicTraffic/buildPublicTrafficCard.js';
import { buildPublicTrafficFeishuText } from '../publicTraffic/buildPublicTrafficFeishu.js';
import { buildOperationsLearningQuestionCard, selectOperationsLearningQuizItems } from '../operationsLearningLoop/quiz.js';
import { formatIdLookupResult, lookupProductId } from './idLookup.js';
import { buildIdLookupCard } from './idLookupCard.js';
import { findLatestReportContext, formatLatestSummary, formatProductRows, queryProductRows } from './reportStore.js';
import { parseLlmToolSelection, type LlmToolSelectionProvider } from './llmProvider.js';
import { runReadOnlyToolSelection } from './llmReadOnlyToolAdapter.js';
import { getRegistryBackedLlmTools } from './llmToolSelector.js';
import { findReadOnlyTool } from './readOnlyToolRegistry.js';
import type { BotIntent, BotResponse } from './types.js';

let running = false;

const UNKNOWN_GUIDANCE = '我现在可以查：今日概况、商品、新链接池、待处理任务、转化差、曝光低、高潜力、下架链接、订单情况。你可以问“新链接池怎么样”或“查一下721”。';

export interface HandleBotIntentOptions {
  llmToolSelector?: LlmToolSelectionProvider;
}

export async function handleBotIntent(intent: BotIntent, outputDir = 'output', options: HandleBotIntentOptions = {}): Promise<BotResponse> {
  if (intent.type === 'help') {
    return { text: '可用命令：今日概况｜查询 565｜查ID 565｜商品ID互查｜运营学习｜跑日报｜重发日报｜推送日报到群｜帮助' };
  }

  if (intent.type === 'latest_summary') {
    const latest = await findLatestReportContext(outputDir);
    return { text: latest ? formatLatestSummary(latest.context) : '还没有找到公域日报上下文。' };
  }

  if (intent.type === 'query_product') {
    const latest = await findLatestReportContext(outputDir);
    return { text: latest ? formatProductRows(queryProductRows(latest.context, intent.keyword)) : '还没有找到公域日报上下文。' };
  }

  if (intent.type === 'lookup_product_id') {
    const latest = await findLatestReportContext(outputDir);
    return { text: latest ? formatIdLookupResult(lookupProductId(latest.context, intent.query)) : '还没有找到公域日报上下文。' };
  }

  if (intent.type === 'lookup_product_id_card') {
    return { text: '请输入端内ID或平台商品ID进行互查。', card: buildIdLookupCard() };
  }

  if (intent.type === 'operations_learning_quiz') {
    const latest = await findLatestReportContext(outputDir);
    if (!latest) return { text: '还没有找到公域日报上下文。' };
    const items = selectOperationsLearningQuizItems(latest.context);
    if (items.length === 0) return { text: '今日暂无可用于学习的运营候选。' };
    return {
      text: `运营学习 loop 测验 ${latest.context.date}（第 1/${items.length} 题）`,
      card: buildOperationsLearningQuestionCard(latest.context.date, items[0], { index: 1, total: items.length }),
    };
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
    const latest = await findLatestReportContext(outputDir);
    if (tool) return latest ? tool.run(latest.context, dataIntent) : { text: '还没有找到公域日报上下文。' };
    if (!options.llmToolSelector) return { text: UNKNOWN_GUIDANCE };
    if (!latest) return { text: '还没有找到公域日报上下文。' };

    const rawSelection = await options.llmToolSelector.selectTool({ message: intent.text, tools: getRegistryBackedLlmTools() });
    const parsed = parseLlmToolSelection(rawSelection);
    if (!parsed.ok || parsed.selection.tool === 'none' || parsed.selection.tool === 'get_supported_questions') return { text: UNKNOWN_GUIDANCE };
    const result = await runReadOnlyToolSelection(latest.context, parsed.selection);
    return result.ok ? result.response : { text: UNKNOWN_GUIDANCE };
  }

  return { text: UNKNOWN_GUIDANCE };
}
