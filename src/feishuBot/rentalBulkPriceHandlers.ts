import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildAgentToolConfirmCard, type AgentToolConfirmRequest } from '../agentRuntime/approvalCard.js';
import { recordOperationEvent } from '../agentRuntime/operationLedger.js';
import { saveAgentToolConfirmRequest } from './agentToolConfirmStore.js';
import type { RentalPriceSkillClient } from './rentalPrice.js';
import type { RentalWriteLedgerContext } from './rentalWriteOperationHandlers.js';
import type { BotResponse } from './types.js';

const PRICE_FIELDS = new Set(['rent1day', 'rent2day', 'rent3day', 'rent4day', 'rent5day', 'rent7day', 'rent10day', 'rent15day', 'rent30day', 'rent60day', 'rent90day', 'rent180day', 'marketPrice', 'deposit', 'purchasePrice', 'costPrice', 'finalPayment']);
const MAX_BULK_ITEMS = 80;

interface BulkPlanItem { productId: string; fields: Record<string, string> }
interface BlockedItem { productId?: string; reason: string }
interface RentalBulkPricePlan {
  version: 1;
  planId: string;
  status: 'planned' | 'applied' | 'failed' | 'blocked';
  createdAt: string;
  reason: string;
  items: BulkPlanItem[];
  blockedItems: BlockedItem[];
  summary: { productCount: number; fieldCount: number };
}
interface RentalBulkPriceResult {
  productId: string;
  ok: boolean;
  lines: string[];
  resultFile?: string;
  rollbackFile?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readProductId(value: unknown): string | null {
  const raw = readString(value);
  return raw && /^\d+$/.test(raw) ? raw : null;
}

function readPlanId(value: unknown): string | null {
  const raw = readString(value);
  return raw && /^bulk_price_[A-Za-z0-9_-]+$/.test(raw) ? raw : null;
}

function normalizePrice(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : null;
}

function canonicalFields(fields: Record<string, string>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(fields).sort(([left], [right]) => left.localeCompare(right))));
}

function formatFieldChanges(fields: Record<string, string>): string {
  return Object.entries(fields).map(([field, value]) => `${field}=${value}`).join(', ');
}

function approvalSummaryLines(plan: RentalBulkPricePlan, planPath: string): string[] {
  const productIds = plan.items.map((item) => item.productId);
  const fieldNames = [...new Set(plan.items.flatMap((item) => Object.keys(item.fields)))];
  const representatives = plan.items.slice(0, 5).map((item) => `- ${item.productId}: ${formatFieldChanges(item.fields)}`);
  return [
    `业务摘要：准备批量修改 ${plan.summary.productCount} 个租赁商品价格。`,
    `影响商品：${productIds.slice(0, 10).join('、')}${productIds.length > 10 ? ` 等 ${productIds.length} 个` : ''}`,
    `涉及字段：${fieldNames.join('、')}`,
    '代表变更：',
    ...representatives,
    `计划文件：${planPath}`,
    '确认后：按持久化计划执行 apply、submit、verify、ledger 和报告。',
  ];
}

function paths(outputDir: string, planId: string): { planPath: string; reportPath: string } {
  const root = join(outputDir, 'rental-bulk-price');
  return {
    planPath: join(root, 'plans', `${planId}.json`),
    reportPath: join(root, 'reports', `${planId}.json`),
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function buildPlan(args: Record<string, unknown>, reason: string): RentalBulkPricePlan {
  const items = Array.isArray(args.items) ? args.items : [];
  const normalized = new Map<string, Record<string, string>>();
  const blockedItems: BlockedItem[] = [];
  if (items.length > MAX_BULK_ITEMS) blockedItems.push({ reason: `items must contain at most ${MAX_BULK_ITEMS} products` });
  for (const item of items) {
    if (!isRecord(item)) {
      blockedItems.push({ reason: 'item must be an object' });
      continue;
    }
    const productId = readProductId(item.productId);
    if (!productId) {
      blockedItems.push({ reason: 'productId must be numeric' });
      continue;
    }
    if (!isRecord(item.fields)) {
      blockedItems.push({ productId, reason: 'fields must be an object' });
      continue;
    }
    const fields: Record<string, string> = {};
    const invalidFields: string[] = [];
    for (const [field, value] of Object.entries(item.fields)) {
      if (!PRICE_FIELDS.has(field)) {
        invalidFields.push(field);
        continue;
      }
      const normalizedValue = normalizePrice(value);
      if (normalizedValue === null) {
        invalidFields.push(field);
        continue;
      }
      if (normalizedValue !== null) fields[field] = normalizedValue;
    }
    if (invalidFields.length) {
      blockedItems.push({ productId, reason: `invalid rental price fields: ${invalidFields.join(', ')}` });
      continue;
    }
    if (!Object.keys(fields).length) {
      blockedItems.push({ productId, reason: 'no valid rental price fields' });
      continue;
    }
    const existing = normalized.get(productId);
    if (existing && canonicalFields(existing) !== canonicalFields(fields)) {
      blockedItems.push({ productId, reason: 'conflicting duplicate productId' });
      continue;
    }
    normalized.set(productId, fields);
  }
  if (!items.length) blockedItems.push({ reason: 'items must be non-empty' });
  const planId = `bulk_price_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const planItems = [...normalized.entries()].map(([productId, fields]) => ({ productId, fields }));
  return {
    version: 1,
    planId,
    status: blockedItems.length ? 'blocked' : 'planned',
    createdAt: new Date().toISOString(),
    reason,
    items: planItems,
    blockedItems,
    summary: { productCount: planItems.length, fieldCount: planItems.reduce((sum, item) => sum + Object.keys(item.fields).length, 0) },
  };
}

async function readPlan(outputDir: string, planId: string): Promise<RentalBulkPricePlan> {
  const raw = JSON.parse(await readFile(paths(outputDir, planId).planPath, 'utf8')) as unknown;
  if (!isRecord(raw) || raw.version !== 1 || raw.planId !== planId || !Array.isArray(raw.items)) throw new Error('批量改价计划文件无效。');
  return raw as unknown as RentalBulkPricePlan;
}

async function recordBulkEvent(context: RentalWriteLedgerContext | undefined, event: 'execution_started' | 'execution_succeeded' | 'execution_failed', planId: string, status?: string, productId?: string): Promise<void> {
  if (!context) return;
  await recordOperationEvent(context.outputDir, {
    planId: context.decisionId ?? context.runId ?? planId,
    at: new Date().toISOString(),
    ...(context.missionDate ? { partitionDate: context.missionDate } : {}),
    event,
    toolName: 'rental.bulkPriceApply',
    ...(context.runId ? { runId: context.runId } : {}),
    ...(context.decisionId ? { decisionId: context.decisionId } : {}),
    ...(productId ? { subject: { kind: 'product' as const, id: productId } } : {}),
    metadata: { planId, ...(status ? { status } : {}), ...(context.missionDate ? { missionDate: context.missionDate } : {}) },
  });
}

export async function rentalBulkPricePlanResponse(args: Record<string, unknown>, reason: string, _client: RentalPriceSkillClient, outputDir: string, continuation?: AgentToolConfirmRequest['continuation']): Promise<BotResponse> {
  const plan = buildPlan(args, reason);
  const { planPath } = paths(outputDir, plan.planId);
  await writeJson(planPath, plan);
  if (plan.status === 'blocked') {
    return {
      text: `批量租赁改价计划被阻断：${plan.blockedItems.length} 项无效。`,
      metadata: { toolName: 'rental.bulkPricePlan', ok: false, planId: plan.planId, planPath, blockedCount: plan.blockedItems.length },
    };
  }
  const confirmRequest: AgentToolConfirmRequest = {
    toolName: 'rental.bulkPriceApply',
    arguments: { planId: plan.planId },
    reason,
    ...(continuation ? { continuation } : {}),
  };
  const requestRef = await saveAgentToolConfirmRequest(outputDir, confirmRequest);
  const summaryLines = approvalSummaryLines(plan, planPath);
  return {
    text: ['批量租赁改价计划', ...summaryLines].join('\n'),
    card: buildAgentToolConfirmCard(confirmRequest, { requestRef, summaryLines }),
    metadata: { toolName: 'rental.bulkPricePlan', ok: true, planId: plan.planId, planPath, productCount: plan.summary.productCount, fieldCount: plan.summary.fieldCount },
  };
}

export async function rentalBulkPriceApplyResponse(args: Record<string, unknown>, client: RentalPriceSkillClient, outputDir: string, ledgerContext?: RentalWriteLedgerContext): Promise<BotResponse> {
  const planId = readPlanId(args.planId);
  if (!planId) throw new Error('planId is required');
  const plan = await readPlan(outputDir, planId);
  if (plan.status !== 'planned' || plan.blockedItems.length) throw new Error('批量改价计划不可执行。');
  if (plan.items.length === 0 || plan.items.length > MAX_BULK_ITEMS) throw new Error('批量改价计划商品数量无效。');
  await recordBulkEvent(ledgerContext, 'execution_started', planId);
  const startedAt = new Date().toISOString();
  const results: RentalBulkPriceResult[] = [];
  for (const item of plan.items) {
    await recordBulkEvent(ledgerContext, 'execution_started', planId, undefined, item.productId);
    try {
      const result = await client.execute({ mode: 'explicit_fields', productId: item.productId, fields: item.fields });
      results.push({ productId: result.productId, ok: result.ok, lines: result.lines, ...(result.audit?.resultFile ? { resultFile: result.audit.resultFile } : {}), ...(result.audit?.rollbackFile ? { rollbackFile: result.audit.rollbackFile } : {}) });
      await recordBulkEvent(ledgerContext, result.ok ? 'execution_succeeded' : 'execution_failed', planId, undefined, result.productId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ productId: item.productId, ok: false, lines: [`error: ${message}`] });
      await recordBulkEvent(ledgerContext, 'execution_failed', planId, undefined, item.productId);
    }
  }
  const ok = results.every((result) => result.ok);
  const status = ok ? 'completed' : 'completed_with_failures';
  const { planPath, reportPath } = paths(outputDir, planId);
  const report = { version: 1, planId, status, startedAt, finishedAt: new Date().toISOString(), results };
  await writeJson(reportPath, report);
  await writeJson(planPath, { ...plan, status: ok ? 'applied' : 'failed' });
  await recordBulkEvent(ledgerContext, ok ? 'execution_succeeded' : 'execution_failed', planId, status);
  return { text: `批量租赁改价${ok ? '完成' : '部分失败'}：${plan.items.length} 个商品\n报告：${reportPath}`, metadata: { toolName: 'rental.bulkPriceApply', ok, planId, status, reportPath } };
}
