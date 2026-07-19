import { mkdir, open, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { recordOperationEvent } from '../../agentRuntime/operationLedger.js';
import type { BotResponse } from '../../feishuBot/types.js';
import type { RentalPriceCopyResult, RentalPriceDelistResult, RentalPriceSkillClient } from '../../feishuBot/rentalPrice.js';
import type { RentalWriteLedgerContext } from '../../feishuBot/rentalWriteOperationHandlers.js';
import { recordInactiveRefreshObservations } from '../../operationObservations/store.js';
import { isInactiveRefreshPlanRef, loadInactiveRefreshPlan, verifyInactiveRefreshPlanKey } from './planStore.js';

export async function executeInactiveRefreshPlan(input: { outputDir: string; planRef: string; confirmationKey: string; client: RentalPriceSkillClient; ledgerContext?: RentalWriteLedgerContext }): Promise<BotResponse> {
  if (!isInactiveRefreshPlanRef(input.planRef)) return invalidPlanResponse();
  const plan = await loadInactiveRefreshPlan(input.outputDir, input.planRef);
  if (!plan || !verifyInactiveRefreshPlanKey(plan, input.confirmationKey)) {
    return invalidPlanResponse();
  }
  const claimed = await claimExecution(input.outputDir, input.planRef);
  if (!claimed) return { text: '失活刷新计划已执行或处理中，请重新发起。', metadata: { toolName: 'operations.inactiveRefreshExecute', ok: false } };
  const copyResults: RentalPriceCopyResult[] = [];
  const delistResults: RentalPriceDelistResult[] = [];
  for (const item of plan.newLinkItems) {
    for (let index = 0; index < item.count; index += 1) {
      const result = await input.client.copy(item.sourceProductId);
      copyResults.push(result);
      if (!result.ok) {
        await writeAudit(input.outputDir, input.planRef, { plan, copyResults, delistResults, ok: false });
        return { text: `失活刷新执行中断：补链源 ${item.sourceProductId} 复制失败，未下架原链接。`, metadata: { toolName: 'operations.inactiveRefreshExecute', ok: false, newProductIds: copyResults.flatMap((copy) => copy.newProductId ? [copy.newProductId] : []), delistedProductIds: [] } };
      }
      if (!result.newProductId) {
        await writeAudit(input.outputDir, input.planRef, { plan, copyResults, delistResults, ok: false });
        return { text: `失活刷新执行中断：补链源 ${item.sourceProductId} 复制未返回新链接 ID，未下架原链接。`, metadata: { toolName: 'operations.inactiveRefreshExecute', ok: false, newProductIds: copyResults.flatMap((copy) => copy.newProductId ? [copy.newProductId] : []), delistedProductIds: [] } };
      }
    }
  }
  for (const productId of plan.delistProductIds) {
    await recordWriteEvent(input, 'execution_started', productId);
    const result = await input.client.delist(productId);
    delistResults.push(result);
    await recordWriteEvent(input, result.ok ? 'execution_succeeded' : 'execution_failed', productId);
    if (!result.ok) break;
  }
  const ok = copyResults.every((result) => result.ok) && delistResults.length === plan.delistProductIds.length && delistResults.every((result) => result.ok);
  const auditPath = await writeAudit(input.outputDir, input.planRef, { plan, copyResults, delistResults, ok });
  if (ok) {
    await recordInactiveRefreshObservationsBestEffort(input.outputDir, {
      planRef: input.planRef,
      auditPath,
      newProductIds: copyResults.flatMap((copy) => copy.newProductId ? [copy.newProductId] : []),
      delistedProductIds: delistResults.filter((result) => result.ok).map((result) => result.productId),
      sourceProductIds: plan.newLinkItems.flatMap((item) => Array.from({ length: item.count }, () => item.sourceProductId)),
    });
  }
  return {
    text: [
      ok ? '失活刷新执行完成' : '失活刷新执行中断',
      `补链：成功 ${copyResults.filter((result) => result.ok).length}/${plan.newLinkItems.reduce((sum, item) => sum + item.count, 0)}`,
      `下架：成功 ${delistResults.filter((result) => result.ok).length}/${plan.delistProductIds.length}`,
      `审计文件：${auditPath}`,
    ].join('\n'),
    metadata: {
      toolName: 'operations.inactiveRefreshExecute',
      ok,
      auditPath,
      newProductIds: copyResults.flatMap((copy) => copy.newProductId ? [copy.newProductId] : []),
      delistedProductIds: delistResults.filter((result) => result.ok).map((result) => result.productId),
    },
  };
}

async function recordInactiveRefreshObservationsBestEffort(outputDir: string, input: { planRef: string; auditPath: string; newProductIds: string[]; delistedProductIds: string[]; sourceProductIds: string[] }): Promise<void> {
  try {
    await recordInactiveRefreshObservations(outputDir, input);
  } catch (error) {
    console.warn(`操作观察写入失败：operations.inactiveRefreshExecute ${input.planRef}：${error instanceof Error ? error.message : String(error)}`);
  }
}

function invalidPlanResponse(): BotResponse {
  return { text: '失活刷新计划已失效，请重新发起。', metadata: { toolName: 'operations.inactiveRefreshExecute', ok: false } };
}

async function claimExecution(outputDir: string, planRef: string): Promise<boolean> {
  const path = join(outputDir, 'latest', 'inactive-refresh-executions', `${planRef}.lock`);
  await mkdir(dirname(path), { recursive: true });
  try {
    const handle = await open(path, 'wx');
    await handle.writeFile(JSON.stringify({ planRef, claimedAt: new Date().toISOString() }));
    await handle.close();
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return false;
    throw error;
  }
}

async function recordWriteEvent(input: { outputDir: string; planRef: string; ledgerContext?: RentalWriteLedgerContext }, event: 'execution_started' | 'execution_succeeded' | 'execution_failed', productId: string): Promise<void> {
  if (!input.ledgerContext) return;
  await recordOperationEvent(input.ledgerContext.outputDir, {
    planId: input.planRef,
    at: new Date().toISOString(),
    ...(input.ledgerContext.missionDate ? { partitionDate: input.ledgerContext.missionDate } : {}),
    event,
    toolName: 'operations.inactiveRefreshExecute',
    ...(input.ledgerContext.runId ? { runId: input.ledgerContext.runId } : {}),
    ...(input.ledgerContext.decisionId ? { decisionId: input.ledgerContext.decisionId } : {}),
    subject: { kind: 'product', id: productId },
  });
}

async function writeAudit(outputDir: string, planRef: string, value: unknown): Promise<string> {
  if (!isInactiveRefreshPlanRef(planRef)) throw new Error('invalid inactive refresh planRef');
  const path = join(outputDir, 'latest', 'inactive-refresh-audits', `${planRef}.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return path;
}
