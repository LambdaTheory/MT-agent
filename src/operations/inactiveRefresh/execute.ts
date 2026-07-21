import { mkdir, open, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { recordOperationEvent } from '../../agentRuntime/operationLedger.js';
import type { ClosedOrderRegistryPathsInput } from '../../closedOrderFeedback/runtime.js';
import type { BotResponse } from '../../feishuBot/types.js';
import type { RentalPriceCopyResult, RentalPriceDelistResult, RentalPriceReadResult, RentalPriceSkillClient } from '../../feishuBot/rentalPrice.js';
import type { RentalWriteLedgerContext } from '../../feishuBot/rentalWriteOperationHandlers.js';
import { mutateJsonFileSerialized } from '../../linkRegistry/persistence.js';
import type { LinkRegistryOverrides } from '../../linkRegistry/overrides.js';
import { recordInactiveRefreshObservations } from '../../operationObservations/store.js';
import { isInactiveRefreshPlanRef, loadInactiveRefreshPlan, verifyInactiveRefreshPlanKey } from './planStore.js';

export async function executeInactiveRefreshPlan(input: { outputDir: string; planRef: string; confirmationKey: string; client: RentalPriceSkillClient; ledgerContext?: RentalWriteLedgerContext; closedOrderRegistryPaths?: ClosedOrderRegistryPathsInput }): Promise<BotResponse> {
  if (!isInactiveRefreshPlanRef(input.planRef)) return invalidPlanResponse();
  const plan = await loadInactiveRefreshPlan(input.outputDir, input.planRef);
  if (!plan || !verifyInactiveRefreshPlanKey(plan, input.confirmationKey)) {
    return invalidPlanResponse();
  }
  const copyResults: RentalPriceCopyResult[] = [];
  const delistResults: RentalPriceDelistResult[] = [];
  const preflight = await validatePlanPreflight(input.client, plan);
  if (!preflight.ok) {
    await writeAudit(input.outputDir, input.planRef, { plan, copyResults, delistResults, ok: false, preflight });
    return { text: `失活刷新执行前校验失败：${preflight.reason}。未复制新链，未下架原链接。`, metadata: { toolName: 'operations.inactiveRefreshExecute', ok: false, newProductIds: [], delistedProductIds: [] } };
  }
  const claimed = await claimExecution(input.outputDir, input.planRef);
  if (!claimed) return { text: '失活刷新计划已执行或处理中，请重新发起。', metadata: { toolName: 'operations.inactiveRefreshExecute', ok: false } };
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
      if (!isValidRegistryProductId(result.newProductId)) {
        await writeAudit(input.outputDir, input.planRef, { plan, copyResults, delistResults, ok: false, invalidNewProductId: result.newProductId });
        return { text: `失活刷新执行中断：补链源 ${item.sourceProductId} 返回的新链接 ID 无效，未下架原链接。`, metadata: { toolName: 'operations.inactiveRefreshExecute', ok: false, newProductIds: [], delistedProductIds: [] } };
      }
    }
  }
  for (const productId of plan.delistProductIds) {
    await recordWriteEvent(input, 'execution_started', productId);
    const result = await input.client.delist(productId);
    delistResults.push(result);
    await recordWriteEvent(input, result.ok ? 'execution_succeeded' : 'execution_failed', productId);
  }
  const ok = copyResults.every((result) => result.ok) && delistResults.length === plan.delistProductIds.length && delistResults.every((result) => result.ok);
  const auditPath = await writeAudit(input.outputDir, input.planRef, { plan, copyResults, delistResults, ok });
  const newProductIds = copyResults.flatMap((copy) => copy.newProductId ? [copy.newProductId] : []);
  const delistedProductIds = delistResults.filter((result) => result.ok).map((result) => result.productId);
  const failedDelists = delistResults.filter((result) => !result.ok);
  const failedDelistProductIds = failedDelists.map((result) => result.productId);
  const sourceItems = plan.newLinkItems.flatMap((item) => Array.from({ length: item.count }, () => item));
  const registryWritebackError = await writeInactiveRefreshRegistryState(input.closedOrderRegistryPaths?.overridesPath ?? defaultOverridesPath(input.outputDir), {
    date: plan.date,
    observedAt: new Date().toISOString(),
    newLinks: copyResults.flatMap((copy, index) => copy.newProductId ? [{ productId: copy.newProductId, source: sourceItems[index] }] : []),
    delistedProductIds,
  }).then(() => null, (error: unknown) => error instanceof Error ? error.message : String(error));
  await recordInactiveRefreshObservationsBestEffort(input.outputDir, {
    planRef: input.planRef,
    auditPath,
    newProductIds,
    delistedProductIds,
    sourceProductIds: sourceItems.map((item) => item.sourceProductId),
  });
  if (registryWritebackError) {
    return {
      text: [
        ok ? '失活刷新执行完成，但 link registry 状态写回失败' : '失活刷新部分完成，但 link registry 状态写回失败',
        `补链：成功 ${copyResults.filter((result) => result.ok).length}/${plan.newLinkItems.reduce((sum, item) => sum + item.count, 0)}`,
        `下架：成功 ${delistResults.filter((result) => result.ok).length}/${plan.delistProductIds.length}`,
        failedDelistProductIds.length ? `下架失败：${failedDelistProductIds.join('、')}` : undefined,
        firstDelistFailureReason(failedDelists),
        `写回错误：${registryWritebackError}`,
        `审计文件：${auditPath}`,
      ].filter((line): line is string => Boolean(line)).join('\n'),
      metadata: { ...inactiveRefreshExecuteMetadata(ok, auditPath, newProductIds, delistedProductIds, failedDelists), operationOk: ok, registryWritebackOk: false },
    };
  }
  return {
    text: [
      ok ? '失活刷新执行完成' : '失活刷新部分完成：下架失败项已跳过，其余旧链已继续尝试',
      `补链：成功 ${copyResults.filter((result) => result.ok).length}/${plan.newLinkItems.reduce((sum, item) => sum + item.count, 0)}`,
      `下架：成功 ${delistResults.filter((result) => result.ok).length}/${plan.delistProductIds.length}`,
      failedDelistProductIds.length ? `下架失败：${failedDelistProductIds.join('、')}` : undefined,
      firstDelistFailureReason(failedDelists),
      `审计文件：${auditPath}`,
    ].filter((line): line is string => Boolean(line)).join('\n'),
    metadata: {
      ...inactiveRefreshExecuteMetadata(ok, auditPath, newProductIds, delistedProductIds, failedDelists),
      registryWritebackOk: true,
    },
  };
}

function inactiveRefreshExecuteMetadata(ok: boolean, auditPath: string, newProductIds: string[], delistedProductIds: string[], failedDelists: RentalPriceDelistResult[]): Record<string, unknown> {
  return {
    toolName: 'operations.inactiveRefreshExecute',
    ok,
    auditPath,
    newProductIds,
    delistedProductIds,
    failedDelistProductIds: failedDelists.map((result) => result.productId),
    delistFailures: failedDelists.map((result) => ({
      productId: result.productId,
      ...(result.message ? { message: result.message } : {}),
      ...(result.status ? { status: result.status } : {}),
      ...(result.confirmed !== undefined ? { confirmed: result.confirmed } : {}),
      ...(result.confirmText ? { confirmText: result.confirmText } : {}),
      ...(result.channelLabel ? { channelLabel: result.channelLabel } : {}),
    })),
  };
}

function firstDelistFailureReason(failedDelists: RentalPriceDelistResult[]): string | undefined {
  const first = failedDelists[0];
  if (!first?.message) return undefined;
  return `首个失败原因：${localizeDelistFailureReason(first.message)}`;
}

function localizeDelistFailureReason(reason: string): string {
  if (/Delist confirmation dialog was not confirmed/i.test(reason)) return '确认弹窗未被自动确认（可能是页面弹窗识别未覆盖，或自动化进程未加载最新代码）';
  return reason;
}

function defaultOverridesPath(outputDir: string): string {
  return join(outputDir, '..', 'config', 'link-registry-overrides.json');
}

async function writeInactiveRefreshRegistryState(overridesPath: string, input: { date: string; observedAt: string; newLinks: Array<{ productId: string; source?: { keyword: string; sourceProductName: string; sameSkuGroupId?: string } }>; delistedProductIds: string[] }): Promise<void> {
  const invalidNewLink = input.newLinks.find((item) => !isValidRegistryProductId(item.productId));
  if (invalidNewLink) throw new Error(`invalid newProductId for link registry writeback: ${invalidNewLink.productId}`);
  const invalidDelistProductId = input.delistedProductIds.find((productId) => !isValidRegistryProductId(productId));
  if (invalidDelistProductId) throw new Error(`invalid delistProductId for link registry writeback: ${invalidDelistProductId}`);
  await mutateJsonFileSerialized<LinkRegistryOverrides>(overridesPath, { version: 1 }, (existing) => {
    const entries = [...(existing.entries ?? [])];
    for (const productId of input.delistedProductIds) {
      upsertOverrideEntry(entries, {
        internalProductId: productId,
        status: 'removed',
        listingState: 'delisted',
        statusObservedAt: input.observedAt,
        updatedAt: input.date,
        reason: 'inactive_refresh_success',
      });
    }
    for (const link of input.newLinks) {
      upsertOverrideEntry(entries, {
        internalProductId: link.productId,
        ...(link.source?.sourceProductName ? { productName: link.source.sourceProductName } : {}),
        ...(link.source?.keyword ? { shortName: link.source.keyword } : {}),
        ...(link.source?.sameSkuGroupId ? { sameSkuGroupId: link.source.sameSkuGroupId } : {}),
        status: 'active',
        listingState: 'on_sale',
        statusObservedAt: input.observedAt,
        updatedAt: input.date,
        reason: 'inactive_refresh_success',
      });
    }
    entries.sort((left, right) => left.internalProductId.localeCompare(right.internalProductId, undefined, { numeric: true }));
    return { ...existing, version: 1, entries };
  });
}

function upsertOverrideEntry(entries: NonNullable<LinkRegistryOverrides['entries']>, patch: NonNullable<LinkRegistryOverrides['entries']>[number]): void {
  const index = entries.findIndex((entry) => entry.internalProductId === patch.internalProductId);
  if (index >= 0) entries[index] = { ...entries[index], ...patch };
  else entries.push(patch);
}

function isValidRegistryProductId(productId: string): boolean {
  return /^\d+$/.test(productId.trim());
}

async function validatePlanPreflight(client: RentalPriceSkillClient, plan: { newLinkItems: Array<{ sourceProductId: string }>; delistProductIds: string[] }): Promise<{ ok: true } | { ok: false; reason: string; productId?: string; role?: 'source' | 'delist' }> {
  if (typeof client.read !== 'function') return { ok: false, reason: '租赁客户端缺少执行前读取能力' };
  const read = client.read;
  const sourceProductIds = [...new Set(plan.newLinkItems.map((item) => item.sourceProductId))];
  for (const productId of sourceProductIds) {
    const result = await readPreflight(read, productId);
    if (!isReadableCurrent(result)) return { ok: false, reason: `补链源 ${productId} 当前不可读取或不可操作`, productId, role: 'source' };
  }
  for (const productId of plan.delistProductIds) {
    const result = await readPreflight(read, productId);
    if (!isReadableCurrent(result)) return { ok: false, reason: `待下架链接 ${productId} 当前不可读取或不可操作`, productId, role: 'delist' };
  }
  return { ok: true };
}

async function readPreflight(read: (productId: string) => Promise<RentalPriceReadResult>, productId: string): Promise<RentalPriceReadResult | null> {
  try {
    return await read(productId);
  } catch {
    return null;
  }
}

function isReadableCurrent(result: RentalPriceReadResult | null): result is RentalPriceReadResult {
  if (!result?.ok) return false;
  if (result.specs.length > 0) return true;
  return Object.keys(result.values).length > 0;
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
