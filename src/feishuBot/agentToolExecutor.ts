import { join } from 'node:path';
import { runPublicTrafficReportCli } from '../cli/publicTrafficReport.js';
import type { AgentToolConfirmRequest } from '../agentRuntime/approvalCard.js';
import { loadConfig } from '../config/loadConfig.js';
import { loadEnv } from '../config/loadEnv.js';
import { loadClosedOrderIngestState } from '../closedOrderFeedback/ingest.js';
import { buildClosedOrderObservationReport, writeClosedOrderObservationReportArtifacts } from '../closedOrderFeedback/observation.js';
import { loadClosedOrderRegistryContext, type ClosedOrderRegistryPathsInput } from '../closedOrderFeedback/runtime.js';
import { syncClosedOrderFeedbackFromApi } from '../closedOrderFeedback/sync.js';
import { sendFeishuCard } from '../notify/feishu.js';
import { buildPublicTrafficCard } from '../publicTraffic/buildPublicTrafficCard.js';
import { buildPublicTrafficFeishuText } from '../publicTraffic/buildPublicTrafficFeishu.js';
import { runDashboardRefresh } from '../publicTraffic/dashboardRefresh.js';
import { startOperationsLearningSession } from '../operationsLearningLoop/session.js';
import type { BotResponse } from './types.js';
import type { FeishuSendTo } from './types.js';
import { buildClosedOrderObservationCard } from './closedOrderObservationCard.js';
import { formatIdLookupResult, lookupProductId } from './idLookup.js';
import {
  buildRentalPricePreviewCard,
  createRentalPriceSkillClient,
  executeRentalOperationConfirmRequest,
  parseRentalOperationConfirmRequest,
  rentalPriceChangeRequestFromToolArguments,
  rentalPriceRollbackRequestFromToolArguments,
  type RentalOperationConfirmRequest,
  type RentalPriceSkillClient,
} from './rentalPrice.js';
import { findLatestReportContext, formatLatestSummary, formatProductRows, queryProductRows } from './reportStore.js';

export interface AgentToolExecutionOptions {
  rentalPriceClient?: RentalPriceSkillClient;
  closedOrderFetchImpl?: typeof fetch;
  closedOrderRegistryPaths?: ClosedOrderRegistryPathsInput;
}

let publicTrafficReportRunning = false;

function formatPublicTrafficReportRunSuccess(result: Awaited<ReturnType<typeof runPublicTrafficReportCli>>): string {
  return [
    '公域日报已生成并发送。',
    `抓取日志：${result.logPath}`,
    '',
    result.dashboardCrawlSummary,
  ].filter((line) => line !== undefined).join('\n');
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireString(value: unknown, fieldName: string): string {
  const parsed = readString(value);
  if (!parsed) throw new Error(`${fieldName} is required`);
  return parsed;
}

function requireProductId(value: unknown, fieldName: string): string {
  const parsed = requireString(value, fieldName);
  if (!/^\d+$/.test(parsed)) throw new Error(`${fieldName} must be numeric`);
  return parsed;
}

function requireTenancyDays(value: unknown, fieldName: string): string {
  const parsed = requireString(value, fieldName);
  if (!/^\d+(?:,\d+)*$/.test(parsed)) throw new Error(`${fieldName} must be comma-separated day numbers`);
  return parsed;
}

function rentalAgentToolRequest(toolName: string, args: Record<string, unknown>): RentalOperationConfirmRequest | null {
  switch (toolName) {
    case 'rental.copy':
      return { action: 'copy', productId: requireProductId(args.productId, 'productId') };
    case 'rental.delist':
      return { action: 'delist', productId: requireProductId(args.productId, 'productId') };
    case 'rental.tenancySet':
      return {
        action: 'tenancy-set',
        productId: requireProductId(args.productId, 'productId'),
        days: requireTenancyDays(args.days, 'days'),
      };
    case 'rental.specDiscover':
      return { action: 'spec-discover', productId: requireProductId(args.productId, 'productId') };
    case 'rental.specAddAndRefresh':
      return {
        action: 'spec-add-and-refresh',
        productId: requireProductId(args.productId, 'productId'),
        itemTitle: requireString(args.itemTitle, 'itemTitle'),
      };
    default:
      return null;
  }
}

function closedOrderIngestStatePath(outputDir: string): string {
  return join(outputDir, 'state', 'closed-order-feedback-ingest.json');
}

function closedOrderObservationArtifactPaths(outputDir: string, reportDate: string): { jsonPath: string; markdownPath: string } {
  const baseDir = join(outputDir, 'closed-order-observation');
  const baseName = `closed-order-observation-${reportDate}`;
  return {
    jsonPath: join(baseDir, `${baseName}.json`),
    markdownPath: join(baseDir, `${baseName}.md`),
  };
}

function formatClosedOrderSyncSummary(result: Awaited<ReturnType<typeof syncClosedOrderFeedbackFromApi>>): string {
  return `关单同步完成：拉取 ${result.fetchedCount} 条，新增 ${result.addedCount} 条，更新 ${result.updatedCount} 条，累计 ${result.totalCount} 条。`;
}

function formatClosedOrderObservationSummary(
  report: Awaited<ReturnType<typeof buildClosedOrderObservationReport>>,
  artifactMarkdownPath?: string,
): string {
  const base = `关单观察 ${report.date}：近 ${report.windowDays} 天 ${report.summary.recordCount} 条，今日 ${report.summary.todayRecordCount} 条，重点分组 ${report.summary.groupCount} 个，需人工复核 ${report.summary.manualReviewGroupCount} 个。`;
  return artifactMarkdownPath ? `${base}\n报告已写入：${artifactMarkdownPath}` : base;
}

function readSendTo(value: unknown): FeishuSendTo | undefined {
  if (value === 'personal' || value === 'group' || value === 'both') return value;
  if (value === undefined) return undefined;
  throw new Error('sendTo must be personal, group, or both');
}

function readOptionalDate(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const parsed = readString(value);
  if (!parsed || !/^\d{4}-\d{2}-\d{2}$/.test(parsed)) throw new Error('date must be YYYY-MM-DD');
  return parsed;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function executeAgentToolRequest(
  request: AgentToolConfirmRequest,
  outputDir = 'output',
  options: AgentToolExecutionOptions = {},
): Promise<BotResponse> {
  switch (request.toolName) {
    case 'publicTraffic.latestSummary': {
      const latest = await findLatestReportContext(outputDir);
      return { text: latest ? formatLatestSummary(latest.context) : '还没有找到公域日报上下文。' };
    }
    case 'product.query': {
      const latest = await findLatestReportContext(outputDir);
      const keyword = requireString(request.arguments.keyword, 'keyword');
      return { text: latest ? formatProductRows(queryProductRows(latest.context, keyword)) : '还没有找到公域日报上下文。' };
    }
    case 'productId.lookup': {
      const latest = await findLatestReportContext(outputDir);
      const query = requireString(request.arguments.keyword, 'keyword');
      return { text: latest ? formatIdLookupResult(lookupProductId(latest.context, query)) : '还没有找到公域日报上下文。' };
    }
    case 'operationsLearning.startQuiz': {
      const latest = await findLatestReportContext(outputDir);
      return latest ? startOperationsLearningSession(outputDir, latest.context) : { text: '还没有找到公域日报上下文。' };
    }
    case 'publicTraffic.runReport':
      if (publicTrafficReportRunning) return { text: '公域日报正在运行中，请稍后再试。' };
      publicTrafficReportRunning = true;
      try {
        const result = await runPublicTrafficReportCli();
        return { text: formatPublicTrafficReportRunSuccess(result) };
      } finally {
        publicTrafficReportRunning = false;
      }
    case 'publicTraffic.resendLatestReport': {
      const latest = await findLatestReportContext(outputDir);
      if (!latest) return { text: '还没有找到可重发的公域日报。' };
      const card = buildPublicTrafficCard(latest.context, { markdownPath: '', workbookPath: '' });
      const fallbackText = buildPublicTrafficFeishuText(latest.context, { markdownPath: '', workbookPath: '' });
      const sendTo = readSendTo(request.arguments.sendTo);
      const env = sendTo ? { ...process.env, FEISHU_SEND_TO: sendTo } : process.env;
      const result = await sendFeishuCard(env, card, fallbackText);
      return { text: result.sent ? '最新公域日报已重发。' : `公域日报重发失败：${result.reason}` };
    }
    case 'publicTraffic.pushLatestReportToGroup': {
      const latest = await findLatestReportContext(outputDir);
      if (!latest) return { text: '还没有找到可推送的公域日报。' };
      const card = buildPublicTrafficCard(latest.context, { markdownPath: '', workbookPath: '' });
      const fallbackText = buildPublicTrafficFeishuText(latest.context, { markdownPath: '', workbookPath: '' });
      const result = await sendFeishuCard({ ...process.env, FEISHU_SEND_TO: 'group' }, card, fallbackText);
      return { text: result.sent ? '最新公域日报已推送到群。' : `公域日报推送到群失败：${result.reason}` };
    }
    case 'publicTraffic.refreshDashboard': {
      await loadEnv();
      const config = await loadConfig();
      const sendTo = readSendTo(request.arguments.sendTo);
      const date = readOptionalDate(request.arguments.date) ?? today();
      const result = await runDashboardRefresh({ config, date, sendTo });
      return {
        text: [
          `访问页补抓完成：${result.message}`,
          `日期：${date}`,
          '',
          `补抓结果：${result.refreshQualityText}`,
          '',
          `首版状态：${result.firstQualityText}`,
        ].join('\n'),
      };
    }
    case 'rental.copy':
    case 'rental.delist':
    case 'rental.tenancySet':
    case 'rental.specDiscover':
    case 'rental.specAddAndRefresh': {
      const rentalRequest = rentalAgentToolRequest(request.toolName, request.arguments);
      if (!rentalRequest) throw new Error('租赁商品操作参数无效，请重新发起。');
      const result = await executeRentalOperationConfirmRequest(options.rentalPriceClient ?? createRentalPriceSkillClient(), rentalRequest);
      return { text: result.text };
    }
    case 'rental.operationConfirmRequest': {
      const rentalRequest = parseRentalOperationConfirmRequest({ request: request.arguments });
      if (!rentalRequest) throw new Error('租赁商品操作参数无效，请重新发起。');
      const result = await executeRentalOperationConfirmRequest(options.rentalPriceClient ?? createRentalPriceSkillClient(), rentalRequest);
      return { text: result.text };
    }
    case 'rental.priceChange': {
      const rentalRequest = rentalPriceChangeRequestFromToolArguments(request.arguments);
      if (!rentalRequest) throw new Error('租赁商品改价参数无效，请重新发起。');
      const client = options.rentalPriceClient ?? createRentalPriceSkillClient();
      const preview = await client.preview(rentalRequest);
      return { text: `请确认商品 ${rentalRequest.productId} 改价`, card: buildRentalPricePreviewCard(preview) };
    }
    case 'rental.priceRollback': {
      const rollbackRequest = rentalPriceRollbackRequestFromToolArguments(request.arguments);
      if (!rollbackRequest) throw new Error('租赁商品改价回滚参数无效，请提供 taskId 或 rollbackFile；productId 可选。');
      const client = options.rentalPriceClient ?? createRentalPriceSkillClient();
      if (!client.rollback) throw new Error('当前租赁改价客户端不支持回滚。');
      const result = await client.rollback(rollbackRequest);
      return { text: `${result.ok ? '改价回滚成功' : '改价回滚失败'}：商品 ${result.productId}\n${result.lines.join('\n')}` };
    }
    case 'closedOrder.syncFeedback': {
      const result = await syncClosedOrderFeedbackFromApi(
        closedOrderIngestStatePath(outputDir),
        process.env,
        20,
        options.closedOrderFetchImpl ?? fetch,
      );
      return { text: formatClosedOrderSyncSummary(result) };
    }
    case 'closedOrder.runObservationReport': {
      const [state, registryContext] = await Promise.all([
        loadClosedOrderIngestState(closedOrderIngestStatePath(outputDir)),
        loadClosedOrderRegistryContext(options.closedOrderRegistryPaths),
      ]);
      const report = await buildClosedOrderObservationReport(state.items, registryContext.query);
      const artifactPaths = closedOrderObservationArtifactPaths(outputDir, report.date);
      await writeClosedOrderObservationReportArtifacts(artifactPaths.jsonPath, artifactPaths.markdownPath, report);
      return {
        text: formatClosedOrderObservationSummary(report, artifactPaths.markdownPath),
        card: buildClosedOrderObservationCard(report),
      };
    }
    case 'publicTraffic.crawlSources':
      throw new Error('publicTraffic.crawlSources 当前需要 CLI AgentConfig，尚未接入飞书审批执行。');
    default:
      throw new Error(`Unsupported agent tool: ${request.toolName}`);
  }
}
