import { buildAgentToolConfirmCard, type AgentToolConfirmRequest } from '../agentRuntime/approvalCard.js';
import type { FeishuCardPayload } from '../notify/feishuApp.js';
import { saveAgentToolConfirmRequest } from '../feishuBot/agentToolConfirmStore.js';
import type { CustodyCleanupPlan } from './models.js';
import { custodyCleanupPlanConfirmationKey, importCustodyPreviewAudit, saveCustodyCleanupPlan } from './planStore.js';

export interface CustodyCleanupConfirmationCardInput {
  readonly auditPath: string;
  readonly outputDir: string;
  readonly now?: Date;
}

export interface CustodyCleanupConfirmationCardResult {
  readonly plan: CustodyCleanupPlan;
  readonly planPath: string;
  readonly requestRef: string;
  readonly card: FeishuCardPayload;
}

function markdown(content: string): Record<string, unknown> {
  return { tag: 'markdown', content };
}

function sampleCandidateLines(plan: CustodyCleanupPlan): string[] {
  return plan.candidates.slice(0, 6).map((candidate, index) => `${index + 1}. ${candidate.platformProductId} ｜ ${candidate.productName}`);
}

function buildCustodyCleanupRequest(plan: CustodyCleanupPlan): AgentToolConfirmRequest {
  return {
    toolName: 'operations.custodyCleanupExecute',
    arguments: {
      planRef: plan.planRef,
      confirmationKey: custodyCleanupPlanConfirmationKey(plan),
    },
    reason: '用户确认执行支付宝托管冲突清理：仅取消不可变预览计划中的已下架且显式托管商品。',
  };
}

export async function prepareCustodyCleanupConfirmationCard(input: CustodyCleanupConfirmationCardInput): Promise<CustodyCleanupConfirmationCardResult> {
  const plan = await importCustodyPreviewAudit(input.auditPath, { now: input.now });
  const planPath = await saveCustodyCleanupPlan(plan, input.outputDir);
  const request = buildCustodyCleanupRequest(plan);
  const requestRef = await saveAgentToolConfirmRequest(input.outputDir, request);
  const card = buildAgentToolConfirmCard(request, {
    requestRef,
    summaryLines: [
      `计划：${plan.planRef}`,
      `候选：${plan.candidates.length} 个；扫描：${plan.importSummary.pagesVisited} 页；预览写入：${plan.importSummary.cancelledCount}`,
      `有效期至：${plan.expiresAt}`,
    ],
    displayElements: [
      markdown([
        '**托管冲突清理摘要**',
        `来源审计：${plan.sourceAudit.path}`,
        `审计 SHA-256：${plan.sourceAudit.sha256}`,
        '执行边界：确认后只串行取消本计划中的候选；首次无法回读验证即停止。',
      ].join('\n')),
      markdown(['**候选样例（最多 6 条）**', ...sampleCandidateLines(plan), plan.candidates.length > 6 ? `还有 ${plan.candidates.length - 6} 条未在卡片展示。` : undefined].filter((line): line is string => Boolean(line)).join('\n')),
    ],
  });
  return { plan, planPath, requestRef, card };
}
