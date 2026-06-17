import { runPublicTrafficReportCli } from '../cli/publicTrafficReport.js';
import { sendFeishuCard } from '../notify/feishu.js';
import { parseAgentDataIntent } from '../agentData/intent.js';
import { buildPublicTrafficCard } from '../publicTraffic/buildPublicTrafficCard.js';
import { buildPublicTrafficFeishuText } from '../publicTraffic/buildPublicTrafficFeishu.js';
import { buildOperationsLearningQuestionCard, selectOperationsLearningQuizItems } from '../operationsLearningLoop/quiz.js';
import { formatIdLookupResult, lookupProductId } from './idLookup.js';
import { buildIdLookupCard } from './idLookupCard.js';
import { buildRentalOperationConfirmCard, buildRentalPricePreviewCard, createRentalPriceSkillClient, executeRentalOperationConfirmRequest, type RentalOperationConfirmRequest, type RentalPriceSkillClient } from './rentalPrice.js';
import { findLatestReportContext, formatLatestSummary, formatProductRows, queryProductRows } from './reportStore.js';
import { parseLlmToolSelection, type LlmToolSelectionProvider } from './llmProvider.js';
import { getSupportedLlmIntentProposals, parseLlmIntentProposal, type LlmIntentProposalProvider } from './llmIntentProposal.js';
import { runReadOnlyToolSelection } from './llmReadOnlyToolAdapter.js';
import { getRegistryBackedLlmTools } from './llmToolSelector.js';
import { findReadOnlyTool } from './readOnlyToolRegistry.js';
import type { BotIntent, BotResponse } from './types.js';

let running = false;

const UNKNOWN_GUIDANCE = '我现在可以查：今日概况、商品、新链接池、待处理任务、转化差、曝光低、高潜力、下架链接、订单情况。你可以问“新链接池怎么样”或“查一下721”。';

export interface HandleBotIntentOptions {
  llmToolSelector?: LlmToolSelectionProvider;
  llmIntentProposalProvider?: LlmIntentProposalProvider;
  rentalPriceClient?: RentalPriceSkillClient;
}

function rentalIntentToConfirmRequest(intent: BotIntent): RentalOperationConfirmRequest | null {
  switch (intent.type) {
    case 'rental_copy':
      return { action: 'copy', productId: intent.productId };
    case 'rental_delist':
      return { action: 'delist', productId: intent.productId };
    case 'rental_tenancy_set':
      return { action: 'tenancy-set', productId: intent.productId, days: intent.days };
    case 'rental_spec_discover':
      return { action: 'spec-discover', productId: intent.productId };
    case 'rental_spec_add':
      return { action: 'spec-add-and-refresh', productId: intent.productId, itemTitle: intent.itemTitle };
    default:
      return null;
  }
}

export async function handleBotIntent(intent: BotIntent, outputDir = 'output', options: HandleBotIntentOptions = {}): Promise<BotResponse> {
  if (intent.type === 'help') {
    return { text: `📋 数据查询
  今日概况 — 查看今日公域流量概况
  查询 565 — 按关键词查询商品
  查ID 565 — 端内ID与平台商品ID互查
  商品ID互查 — 打开常驻ID互查卡片
  查看规格 761 — 查看商品规格维度与项目

📊 报表操作
  跑日报 — 生成公域流量日报
  重发日报 — 重新发送最新日报
  推送日报到群 — 推送日报到指定群

🎓 运营学习
  运营学习 — 开始运营学习测验

💰 租赁改价
  改价 761 1天22 10天55 — 指定租期改价（格式：改价 ID 租期1价格1 租期2价格2 ...）
  改价 761 全局改价 0.9 — 全局折扣（所有租金字段 ×0.9）
  改价 761 全部租金九折 — 全部租金九折
  改价 761 所有价格 *0.9 — 所有价格乘法（含押金、成本等）

🔧 商品操作
  复制商品 761 — 复制商品
  下架商品 761 — 下架商品
  设置租期 761 1,10,30 — 设置租期天数
  添加规格 761 128G — 添加规格项

❓ 帮助
  帮助 — 显示此帮助信息` };
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
    return { text: '已打开常驻商品ID互查卡，可保留在会话里反复查询。', card: buildIdLookupCard() };
  }

  if (intent.type === 'rental_price_change') {
    const rentalPriceClient = options.rentalPriceClient ?? createRentalPriceSkillClient();
    const preview = await rentalPriceClient.preview(intent.request);
    return { text: `请确认商品 ${intent.productId} 改价`, card: buildRentalPricePreviewCard(preview) };
  }

  if (intent.type === 'rental_copy') {
    const rentalPriceClient = options.rentalPriceClient ?? createRentalPriceSkillClient();
    const result = await rentalPriceClient.copy(intent.productId);
    if (result.ok) {
      return { text: result.newProductId ? `复制成功：商品 ${intent.productId} → 新商品 ${result.newProductId}` : `复制成功：商品 ${intent.productId} 已复制（新商品ID未能自动获取，请到后台确认）` };
    }
    return { text: `复制失败：商品 ${intent.productId}\n${result.lines.join('\n')}` };
  }

  if (intent.type === 'rental_delist') {
    const rentalPriceClient = options.rentalPriceClient ?? createRentalPriceSkillClient();
    const result = await rentalPriceClient.delist(intent.productId);
    return { text: result.ok ? `下架成功：商品 ${result.productId}` : `下架失败：商品 ${result.productId}\n${result.lines.join('\n')}` };
  }

  if (intent.type === 'rental_tenancy_set') {
    const rentalPriceClient = options.rentalPriceClient ?? createRentalPriceSkillClient();
    const result = await rentalPriceClient.tenancySet(intent.productId, intent.days);
    return { text: result.ok ? `租期设置成功：商品 ${result.productId}，租期 ${result.days}` : `租期设置失败：商品 ${result.productId}\n${result.lines.join('\n')}` };
  }

  if (intent.type === 'rental_spec_discover') {
    const rentalPriceClient = options.rentalPriceClient ?? createRentalPriceSkillClient();
    const result = await rentalPriceClient.specDiscover(intent.productId);
    if (result.ok) {
      const dims = result.dimensions.map(d => `  ${d.title}（${d.items.map(i => i.title).join('、')}）`).join('\n');
      return { text: `规格查看成功：商品 ${result.productId}\n${dims || '（无规格维度）'}` };
    }
    return { text: `规格查看失败：商品 ${result.productId}\n${result.lines.join('\n')}` };
  }

  if (intent.type === 'rental_spec_add') {
    const rentalPriceClient = options.rentalPriceClient ?? createRentalPriceSkillClient();
    const result = await rentalPriceClient.specAddAndRefresh(intent.productId, intent.itemTitle);
    return { text: result.ok ? `规格添加成功：商品 ${result.productId}，新增 ${result.itemTitle}` : `规格添加失败：商品 ${result.productId}\n${result.lines.join('\n')}` };
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
    if (options.llmIntentProposalProvider) {
      const rawProposal = await options.llmIntentProposalProvider.proposeIntent({ message: intent.text, intents: getSupportedLlmIntentProposals() });
      const parsedProposal = parseLlmIntentProposal(rawProposal);
      if (parsedProposal.ok && parsedProposal.proposal.intent.type !== 'unknown') {
        const proposedIntent = parsedProposal.proposal.intent;
        const rentalPriceClient = options.rentalPriceClient ?? createRentalPriceSkillClient();
        if (proposedIntent.type === 'rental_price_change') {
          const preview = await rentalPriceClient.preview(proposedIntent.request);
          return { text: `请确认商品 ${proposedIntent.productId} 改价`, card: buildRentalPricePreviewCard(preview) };
        }
        const request = rentalIntentToConfirmRequest(proposedIntent);
        if (request) {
          return { text: `请确认租赁商品操作：${request.productId}`, card: buildRentalOperationConfirmCard(request, parsedProposal.proposal.reason) };
        }
      }
    }

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
