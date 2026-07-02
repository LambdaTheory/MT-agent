import { createHash } from 'node:crypto';
import type { FeishuCardPayload } from '../notify/feishuApp.js';
import { parseAgentToolConfirmContinuation, type AgentToolConfirmContinuation } from '../agentRuntime/approvalCard.js';
import type { LinkRegistryEntry } from '../linkRegistry/types.js';
import type { PublicTrafficDataReportContext, PublicTrafficProductDataRow } from '../publicTraffic/types.js';
import type { RentalPriceSkillClient } from '../feishuBot/rentalPrice.js';

export const NEW_LINK_BATCH_WORKFLOW_NAME = 'rental.newLinkBatch';
export const MAX_NEW_LINK_BATCH_COUNT = 20;
export const MAX_NEW_LINK_BATCH_MULTI_TOTAL_COUNT = 50;
export const NEW_LINK_BATCH_CONFIRMATION_VERSION = 2;

export interface NewLinkBatchWorkflowRequest {
  keyword: string;
  count: number;
  sourceProductId?: string;
  fallbackSourceProductIds?: string[];
}

export interface NewLinkBatchCandidate {
  productId: string;
  platformProductId: string;
  productName: string;
  sameSkuGroupId?: string;
  shortName?: string;
  score: number;
  reasons: string[];
}

export interface NewLinkBatchPlan {
  status: 'ready' | 'needs_review';
  request: NewLinkBatchWorkflowRequest;
  dataDate: string;
  requestedSourceProductId?: string;
  selectedSource?: NewLinkBatchCandidate;
  candidates: NewLinkBatchCandidate[];
  warnings: string[];
}

export interface NewLinkBatchConfirmRequest {
  safetyVersion: typeof NEW_LINK_BATCH_CONFIRMATION_VERSION;
  workflowName: typeof NEW_LINK_BATCH_WORKFLOW_NAME;
  keyword: string;
  count: number;
  sourceProductId: string;
  requestedSourceProductId?: string;
  fallbackSourceProductIds?: string[];
  sourceProductName: string;
  dataDate: string;
  reason: string;
  continuation?: AgentToolConfirmContinuation;
}

export interface NewLinkBatchMultiConfirmRequest {
  safetyVersion: typeof NEW_LINK_BATCH_CONFIRMATION_VERSION;
  workflowName: typeof NEW_LINK_BATCH_WORKFLOW_NAME;
  mode: 'multi-source';
  items: NewLinkBatchConfirmRequest[];
  dataDate: string;
  reason: string;
  continuation?: AgentToolConfirmContinuation;
}

export interface NewLinkBatchExecutionResult {
  ok: boolean;
  text: string;
  newProductIds: string[];
  completedCount: number;
  failedItems?: NewLinkBatchFailedItem[];
}

export interface NewLinkBatchFailedItem {
  keyword: string;
  sourceProductId: string;
  requestedCount: number;
  completedCount: number;
  reason: string;
  skipped: boolean;
  blocking: boolean;
  lines: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readPositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function readProductId(value: unknown): string | null {
  const parsed = readPositiveInteger(value);
  return parsed ? String(parsed) : null;
}

function readExplicitProductIdText(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^(\d+)$/.exec(trimmed)?.[1]
    ?? /^id\s*(\d+)$/i.exec(trimmed)?.[1]
    ?? /^\u7aef\u5185\s*(?:id)?\s*(\d+)$/i.exec(trimmed)?.[1]
    ?? null;
}

function readProductIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(readProductId).filter((item): item is string => Boolean(item)))];
}

function confirmationKey(value: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
}

function readConfirmationKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[a-f0-9]{24}$/i.test(trimmed) ? trimmed.toLowerCase() : null;
}

function hasValidConfirmationKey(value: Record<string, unknown>, request: Record<string, unknown>): boolean {
  return readConfirmationKey(value.confirmationKey) === confirmationKey(request);
}

const NEW_LINK_BATCH_CONFIRM_REQUEST_KEYS = [
  'safetyVersion',
  'workflowName',
  'keyword',
  'count',
  'sourceProductId',
  'requestedSourceProductId',
  'fallbackSourceProductIds',
  'sourceProductName',
  'dataDate',
  'reason',
  'continuation',
] as const;

const NEW_LINK_BATCH_MULTI_CONFIRM_REQUEST_KEYS = [
  'safetyVersion',
  'workflowName',
  'mode',
  'items',
  'dataDate',
  'reason',
  'continuation',
] as const;

function pickDefinedFields(value: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (value[key] !== undefined) picked[key] = value[key];
  }
  return picked;
}

function readConfirmRequestPayload(value: Record<string, unknown>): Record<string, unknown> {
  return isRecord(value.request)
    ? value.request
    : pickDefinedFields(value, NEW_LINK_BATCH_CONFIRM_REQUEST_KEYS);
}

function readMultiConfirmRequestPayload(value: Record<string, unknown>): Record<string, unknown> {
  return isRecord(value.request)
    ? value.request
    : pickDefinedFields(value, NEW_LINK_BATCH_MULTI_CONFIRM_REQUEST_KEYS);
}

export function readNewLinkBatchWorkflowRequest(value: Record<string, unknown>): NewLinkBatchWorkflowRequest | null {
  const rawKeyword = readString(value.keyword);
  const count = readPositiveInteger(value.count);
  const sourceProductId = readProductId(value.sourceProductId) ?? readExplicitProductIdText(rawKeyword);
  const keyword = rawKeyword ?? sourceProductId;
  const fallbackSourceProductIds = readProductIds(value.fallbackSourceProductIds).filter((item) => item !== sourceProductId);
  return keyword && count
    ? { keyword, count, ...(sourceProductId ? { sourceProductId } : {}), ...(fallbackSourceProductIds.length ? { fallbackSourceProductIds } : {}) }
    : null;
}

export function readNewLinkBatchWorkflowRequests(value: Record<string, unknown>): NewLinkBatchWorkflowRequest[] | null {
  if (Array.isArray(value.items)) {
    const requests = value.items.map((item) => (isRecord(item) ? readNewLinkBatchWorkflowRequest(item) : null));
    if (requests.length === 0 || requests.some((request) => request === null)) return null;
    return requests as NewLinkBatchWorkflowRequest[];
  }
  const request = readNewLinkBatchWorkflowRequest(value);
  return request ? [request] : null;
}

function compact(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '').replace(/[\-_]/g, '');
}

function displayProductId(row: PublicTrafficProductDataRow): string {
  const match = row.displayProductId.match(/\d+/);
  return match?.[0] ?? row.displayProductId.trim();
}

function registryText(entry: LinkRegistryEntry): string {
  return [
    entry.internalProductId,
    entry.platformProductId,
    entry.categoryId,
    entry.categoryName,
    entry.productType,
    entry.shortName,
    entry.sameSkuGroupId,
  ].filter((value): value is string => Boolean(value?.trim())).join(' ');
}

function rowText(row: PublicTrafficProductDataRow): string {
  return [displayProductId(row), row.platformProductId, row.productName].join(' ');
}

function matchingRegistryEntries(entries: LinkRegistryEntry[], keyword: string): LinkRegistryEntry[] {
  const query = compact(keyword);
  if (!query) return [];
  const activeEntries = entries.filter((entry) => entry.status !== 'removed');
  const direct = activeEntries.filter((entry) => compact(registryText(entry)).includes(query));
  const sameSkuGroups = new Set(direct.map((entry) => entry.sameSkuGroupId?.trim()).filter((value): value is string => Boolean(value)));
  if (sameSkuGroups.size === 0) return direct;
  return activeEntries.filter((entry) => direct.includes(entry) || (entry.sameSkuGroupId && sameSkuGroups.has(entry.sameSkuGroupId.trim())));
}

function buildRegistryIndexes(entries: LinkRegistryEntry[]): {
  byInternalId: Map<string, LinkRegistryEntry>;
  byPlatformId: Map<string, LinkRegistryEntry>;
} {
  const byInternalId = new Map<string, LinkRegistryEntry>();
  const byPlatformId = new Map<string, LinkRegistryEntry>();
  for (const entry of entries) {
    const internalProductId = entry.internalProductId.trim();
    const platformProductId = entry.platformProductId?.trim();
    if (internalProductId && !byInternalId.has(internalProductId)) byInternalId.set(internalProductId, entry);
    if (platformProductId && !byPlatformId.has(platformProductId)) byPlatformId.set(platformProductId, entry);
  }
  return { byInternalId, byPlatformId };
}

function findRowByInternalProductId(context: PublicTrafficDataReportContext, internalProductId: string): PublicTrafficProductDataRow | undefined {
  return context.rows.find((row) => displayProductId(row) === internalProductId);
}

function findRegistryEntryByInternalProductId(entries: LinkRegistryEntry[], internalProductId: string): LinkRegistryEntry | undefined {
  return entries.find((entry) => entry.internalProductId.trim() === internalProductId);
}

function fallbackCandidatesForSourceIds(
  sourceIds: string[] | undefined,
  context: PublicTrafficDataReportContext,
  registryEntries: LinkRegistryEntry[],
  selectedSourceProductId: string,
): NewLinkBatchCandidate[] {
  if (!sourceIds?.length) return [];
  const seen = new Set([selectedSourceProductId]);
  return sourceIds.flatMap((sourceId) => {
    const id = sourceId.trim();
    if (!/^\d+$/.test(id) || seen.has(id)) return [];
    seen.add(id);
    const sourceRow = findRowByInternalProductId(context, id);
    const sourceRegistryEntry = findRegistryEntryByInternalProductId(registryEntries, id);
    if (!sourceRow || sourceRegistryEntry?.status === 'removed') return [];
    return [candidateFrom(sourceRow, sourceRegistryEntry)];
  });
}

function rowScore(row: PublicTrafficProductDataRow): { score: number; reasons: string[] } {
  const one = row.periods['1d'];
  const seven = row.periods['7d'];
  const thirty = row.periods['30d'];
  const shipped = seven.shippedOrders * 1000 + one.shippedOrders * 300 + thirty.shippedOrders * 100;
  const amount = seven.amount * 2 + one.amount * 3 + thirty.amount * 0.2;
  const visits = seven.publicVisits * 5 + one.publicVisits * 3;
  const exposure = Math.min(seven.exposure, 5000) * 0.1;
  const score = shipped + amount + visits + exposure;
  return {
    score,
    reasons: [
      `7日发货 ${seven.shippedOrders}`,
      `7日成交额 ${seven.amount}`,
      `7日访问 ${seven.publicVisits}`,
      `1日发货 ${one.shippedOrders}`,
    ],
  };
}

function candidateFrom(row: PublicTrafficProductDataRow, registryEntry: LinkRegistryEntry | undefined): NewLinkBatchCandidate {
  const { score, reasons } = rowScore(row);
  return {
    productId: displayProductId(row),
    platformProductId: row.platformProductId,
    productName: row.productName,
    ...(registryEntry?.sameSkuGroupId ? { sameSkuGroupId: registryEntry.sameSkuGroupId } : {}),
    ...(registryEntry?.shortName ? { shortName: registryEntry.shortName } : {}),
    score,
    reasons,
  };
}

export function buildNewLinkBatchPlan(
  request: NewLinkBatchWorkflowRequest,
  context: PublicTrafficDataReportContext,
  registryEntries: LinkRegistryEntry[],
): NewLinkBatchPlan {
  const keyword = request.keyword.trim();
  const count = Math.trunc(request.count);
  const sourceProductId = request.sourceProductId?.trim() ?? readExplicitProductIdText(keyword);
  const warnings: string[] = [];

  if (!keyword) warnings.push('缺少要铺新链的商品关键词。');
  if (!Number.isFinite(count) || count < 1 || count > MAX_NEW_LINK_BATCH_COUNT) warnings.push(`铺新链数量必须在 1-${MAX_NEW_LINK_BATCH_COUNT} 之间。`);

  if (sourceProductId) {
    const sourceRow = findRowByInternalProductId(context, sourceProductId);
    const sourceRegistryEntry = findRegistryEntryByInternalProductId(registryEntries, sourceProductId);
    if (!sourceRow) warnings.push(`没有在最新公域日报里找到端内ID ${sourceProductId}，不能复制。`);
    if (sourceRegistryEntry?.status === 'removed') warnings.push(`端内ID ${sourceProductId} 在链接档案中已下架，不能复制。`);

    const selectedSource = sourceRow ? candidateFrom(sourceRow, sourceRegistryEntry) : undefined;
    const fallbackCandidates = selectedSource
      ? fallbackCandidatesForSourceIds(request.fallbackSourceProductIds, context, registryEntries, selectedSource.productId)
      : [];
    const ready = Boolean(selectedSource && count >= 1 && count <= MAX_NEW_LINK_BATCH_COUNT && warnings.length === 0);
    return {
      status: ready ? 'ready' : 'needs_review',
      request: { keyword, count, sourceProductId, ...(request.fallbackSourceProductIds?.length ? { fallbackSourceProductIds: request.fallbackSourceProductIds } : {}) },
      dataDate: context.date,
      requestedSourceProductId: sourceProductId,
      ...(selectedSource ? { selectedSource } : {}),
      candidates: selectedSource ? [selectedSource, ...fallbackCandidates].slice(0, 5) : [],
      warnings,
    };
  }

  const registryMatches = matchingRegistryEntries(registryEntries, keyword);
  const { byInternalId, byPlatformId } = buildRegistryIndexes(registryMatches);
  const query = compact(keyword);

  const candidates = context.rows
    .filter((row) => {
      const id = displayProductId(row);
      if (registryMatches.length > 0) return byInternalId.has(id) || byPlatformId.has(row.platformProductId);
      return compact(rowText(row)).includes(query);
    })
    .map((row) => candidateFrom(row, byInternalId.get(displayProductId(row)) ?? byPlatformId.get(row.platformProductId)))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || Number(left.productId) - Number(right.productId));

  if (registryMatches.length === 0) warnings.push(`链接档案未命中「${keyword}」，候选仅按日报商品名兜底匹配，不能直接执行。`);
  if (candidates.length === 0) warnings.push(`没有找到「${keyword}」的可用历史表现候选。`);

  const selectedSource = candidates[0];
  const ready = Boolean(selectedSource && count >= 1 && count <= MAX_NEW_LINK_BATCH_COUNT && warnings.length === 0);
  return {
    status: ready ? 'ready' : 'needs_review',
    request: { keyword, count },
    dataDate: context.date,
    ...(selectedSource ? { selectedSource } : {}),
    candidates: candidates.slice(0, 5),
    warnings,
  };
}

export function formatNewLinkBatchPlan(plan: NewLinkBatchPlan): string {
  const header = plan.status === 'ready'
    ? `新链批量铺设计划：准备复制 ${plan.request.count} 条「${plan.request.keyword}」新链`
    : `新链批量铺设计划需要复核：「${plan.request.keyword}」`;
  const source = plan.selectedSource
    ? `推荐源商品：${plan.selectedSource.productId} ${plan.selectedSource.productName}\n依据：${plan.selectedSource.reasons.join('，')}`
    : '推荐源商品：未找到';
  const candidates = plan.candidates.length
    ? plan.candidates.map((candidate, index) => `${index + 1}. ${candidate.productId} ${candidate.productName}（score ${candidate.score.toFixed(1)}）`).join('\n')
    : '无候选';
  const warnings = plan.warnings.length ? `\n复核提示：\n${plan.warnings.map((warning) => `- ${warning}`).join('\n')}` : '';
  return `${header}\n数据日期：${plan.dataDate}\n${source}\n候选排序：\n${candidates}${warnings}\n\n注意：当前仅生成计划和确认卡，确认前不会复制商品。`;
}

export function buildNewLinkBatchConfirmRequest(plan: NewLinkBatchPlan, reason: string, continuation?: AgentToolConfirmContinuation): NewLinkBatchConfirmRequest | null {
  if (plan.status !== 'ready' || !plan.selectedSource) return null;
  if (plan.requestedSourceProductId && plan.selectedSource.productId !== plan.requestedSourceProductId) return null;
  const fallbackSourceProductIds = plan.candidates
    .map((candidate) => candidate.productId)
    .filter((productId) => productId !== plan.selectedSource?.productId)
    .slice(0, 4);
  return {
    safetyVersion: NEW_LINK_BATCH_CONFIRMATION_VERSION,
    workflowName: NEW_LINK_BATCH_WORKFLOW_NAME,
    keyword: plan.request.keyword,
    count: plan.request.count,
    sourceProductId: plan.selectedSource.productId,
    ...(plan.requestedSourceProductId ? { requestedSourceProductId: plan.requestedSourceProductId } : {}),
    ...(fallbackSourceProductIds.length ? { fallbackSourceProductIds } : {}),
    sourceProductName: plan.selectedSource.productName,
    dataDate: plan.dataDate,
    reason,
    ...(continuation ? { continuation } : {}),
  };
}

export function buildNewLinkBatchMultiConfirmRequest(plans: NewLinkBatchPlan[], reason: string, continuation?: AgentToolConfirmContinuation): NewLinkBatchMultiConfirmRequest | null {
  if (plans.length < 2) return null;
  const items = plans.map((plan) => buildNewLinkBatchConfirmRequest(plan, reason));
  if (items.some((item) => item === null)) return null;
  const requests = items as NewLinkBatchConfirmRequest[];
  const totalCount = requests.reduce((sum, request) => sum + request.count, 0);
  if (totalCount > MAX_NEW_LINK_BATCH_MULTI_TOTAL_COUNT) return null;
  const dataDate = requests[0]?.dataDate;
  if (!dataDate || requests.some((request) => request.dataDate !== dataDate)) return null;
  return {
    safetyVersion: NEW_LINK_BATCH_CONFIRMATION_VERSION,
    workflowName: NEW_LINK_BATCH_WORKFLOW_NAME,
    mode: 'multi-source',
    items: requests,
    dataDate,
    reason,
    ...(continuation ? { continuation } : {}),
  };
}

export function explainNewLinkBatchMultiConfirmBlocker(plans: NewLinkBatchPlan[]): string | null {
  if (plans.length < 2) return '多商品新链确认至少需要 2 个商品。';
  const reviewPlan = plans.find((plan) => plan.status !== 'ready');
  if (reviewPlan) {
    return `${reviewPlan.request.keyword} 需要复核：${reviewPlan.warnings.join('；') || '未达到可直接执行条件'}`;
  }
  const totalCount = plans.reduce((sum, plan) => sum + plan.request.count, 0);
  if (totalCount > MAX_NEW_LINK_BATCH_MULTI_TOTAL_COUNT) {
    return `复制总数 ${totalCount} 条超过多商品单次确认上限 ${MAX_NEW_LINK_BATCH_MULTI_TOTAL_COUNT} 条，请减少商品或数量后重试。`;
  }
  return buildNewLinkBatchMultiConfirmRequest(plans, 'confirmability check') ? null : '确认请求校验未通过，请重新发起。';
}

export function formatNewLinkBatchMultiPlan(
  plans: NewLinkBatchPlan[],
  options: { confirmable?: boolean; confirmBlocker?: string | null } = {},
): string {
  const lines = plans.map((plan, index) => {
    const source = plan.selectedSource
      ? `源商品 ${plan.selectedSource.productId} ${plan.selectedSource.productName}`
      : '源商品 未找到';
    const warnings = plan.warnings.length ? `；复核：${plan.warnings.join('；')}` : '';
    return `${index + 1}. ${plan.request.keyword}：${source}，复制 ${plan.request.count} 条${warnings}`;
  });
  const note = options.confirmable === false
    ? `注意：当前仅生成计划，未生成确认卡${options.confirmBlocker ? `：${options.confirmBlocker}` : '。'}确认前不会复制商品。`
    : '注意：当前仅生成计划和确认卡，确认前不会复制商品。';
  return [
    `多商品新链批量铺设计划：准备分别复制 ${plans.length} 个商品`,
    ...lines,
    '',
    note,
  ].join('\n');
}

export function buildNewLinkBatchConfirmCard(plan: NewLinkBatchPlan, reason: string, continuation?: AgentToolConfirmContinuation): FeishuCardPayload | undefined {
  const request = buildNewLinkBatchConfirmRequest(plan, reason, continuation);
  if (!request || !plan.selectedSource) return undefined;
  const key = confirmationKey(request as unknown as Record<string, unknown>);
  const confirmValue = { action: 'new_link_batch_confirm', request, confirmationKey: key };
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: '新链批量复制确认' }, template: 'orange' },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: [
            `**是否从商品 ${request.sourceProductId} 复制 ${request.count} 条「${request.keyword}」新链？**`,
            '',
            `源商品：${request.sourceProductName}`,
            `数据日期：${request.dataDate}`,
            `依据：${plan.selectedSource.reasons.join('，')}`,
            `LLM 理解原因：${reason}`,
          ].join('\n'),
        },
        {
          tag: 'form',
          name: 'new_link_batch_confirm_form',
          elements: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '确认复制' },
              type: 'primary',
              form_action_type: 'submit',
              name: 'new_link_batch_confirm_submit',
              behaviors: [{ type: 'callback', value: confirmValue }],
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '取消' },
              type: 'default',
              form_action_type: 'submit',
              name: 'new_link_batch_cancel_submit',
              behaviors: [{
                type: 'callback',
                value: {
                  action: 'new_link_batch_cancel',
                  keyword: request.keyword,
                  sourceProductId: request.sourceProductId,
                  safetyVersion: NEW_LINK_BATCH_CONFIRMATION_VERSION,
                  confirmationKey: key,
                },
              }],
            },
          ],
        },
      ],
    },
  };
}

export function buildNewLinkBatchMultiConfirmCard(plans: NewLinkBatchPlan[], reason: string, continuation?: AgentToolConfirmContinuation): FeishuCardPayload | undefined {
  const request = buildNewLinkBatchMultiConfirmRequest(plans, reason, continuation);
  if (!request) return undefined;
  const totalCount = request.items.reduce((sum, item) => sum + item.count, 0);
  const key = confirmationKey(request as unknown as Record<string, unknown>);
  const confirmValue = { action: 'new_link_batch_multi_confirm', request, confirmationKey: key };
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: '多商品新链批量复制确认' }, template: 'orange' },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: [
            `**是否分别为 ${request.items.length} 个商品复制新链？总计 ${totalCount} 条。**`,
            '',
            ...request.items.flatMap((item, index) => [
              `${index + 1}. ${item.keyword}`,
              `源商品：${item.sourceProductId} ${item.sourceProductName}`,
              `复制数量：${item.count} 条`,
            ]),
            '',
            `数据日期：${request.dataDate}`,
            `理解原因：${reason}`,
          ].join('\n'),
        },
        {
          tag: 'form',
          name: 'new_link_batch_multi_confirm_form',
          elements: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '确认分别复制' },
              type: 'primary',
              form_action_type: 'submit',
              name: 'new_link_batch_multi_confirm_submit',
              behaviors: [{ type: 'callback', value: confirmValue }],
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '取消' },
              type: 'default',
              form_action_type: 'submit',
              name: 'new_link_batch_cancel_submit',
              behaviors: [{
                type: 'callback',
                value: {
                  action: 'new_link_batch_cancel',
                  keyword: request.items.map((item) => item.keyword).join('、'),
                  safetyVersion: NEW_LINK_BATCH_CONFIRMATION_VERSION,
                  confirmationKey: key,
                },
              }],
            },
          ],
        },
      ],
    },
  };
}

function readNewLinkBatchConfirmRequestRecord(request: Record<string, unknown>): NewLinkBatchConfirmRequest | null {
  const safetyVersion = readPositiveInteger(request.safetyVersion);
  const workflowName = readString(request.workflowName);
  const keyword = readString(request.keyword);
  const count = readPositiveInteger(request.count);
  const sourceProductId = readString(request.sourceProductId);
  const requestedSourceProductId = readString(request.requestedSourceProductId);
  const fallbackSourceProductIds = readProductIds(request.fallbackSourceProductIds).filter((item) => item !== sourceProductId);
  const sourceProductName = readString(request.sourceProductName);
  const dataDate = readString(request.dataDate);
  const reason = readString(request.reason);
  const continuation = parseAgentToolConfirmContinuation(request.continuation);

  if (
    safetyVersion !== NEW_LINK_BATCH_CONFIRMATION_VERSION ||
    workflowName !== NEW_LINK_BATCH_WORKFLOW_NAME ||
    !keyword ||
    !count ||
    count > MAX_NEW_LINK_BATCH_COUNT ||
    !sourceProductId ||
    !/^\d+$/.test(sourceProductId) ||
    (requestedSourceProductId !== null && (!/^\d+$/.test(requestedSourceProductId) || requestedSourceProductId !== sourceProductId)) ||
    !sourceProductName ||
    !dataDate ||
    !reason ||
    (request.continuation !== undefined && !continuation)
  ) {
    return null;
  }

  return {
    safetyVersion: NEW_LINK_BATCH_CONFIRMATION_VERSION,
    workflowName,
    keyword,
    count,
    sourceProductId,
    ...(requestedSourceProductId ? { requestedSourceProductId } : {}),
    ...(fallbackSourceProductIds.length ? { fallbackSourceProductIds } : {}),
    sourceProductName,
    dataDate,
    reason,
    ...(continuation ? { continuation } : {}),
  };
}

export function parseNewLinkBatchConfirmRequest(value: unknown): NewLinkBatchConfirmRequest | null {
  if (!isRecord(value)) return null;
  const request = readConfirmRequestPayload(value);
  const parsed = readNewLinkBatchConfirmRequestRecord(request);
  if (!parsed) return null;
  if (!hasValidConfirmationKey(value, parsed as unknown as Record<string, unknown>)) return null;
  return parsed;
}

export function parseNewLinkBatchMultiConfirmRequest(value: unknown): NewLinkBatchMultiConfirmRequest | null {
  if (!isRecord(value)) return null;
  const request = readMultiConfirmRequestPayload(value);
  const safetyVersion = readPositiveInteger(request.safetyVersion);
  const workflowName = readString(request.workflowName);
  const mode = readString(request.mode);
  const dataDate = readString(request.dataDate);
  const reason = readString(request.reason);
  const continuation = parseAgentToolConfirmContinuation(request.continuation);
  const rawItems = Array.isArray(request.items) ? request.items : [];
  if (
    safetyVersion !== NEW_LINK_BATCH_CONFIRMATION_VERSION ||
    workflowName !== NEW_LINK_BATCH_WORKFLOW_NAME ||
    mode !== 'multi-source' ||
    !dataDate ||
    !reason ||
    rawItems.length < 2 ||
    (request.continuation !== undefined && !continuation)
  ) return null;
  const items = rawItems.map((item) => isRecord(item) ? readNewLinkBatchConfirmRequestRecord(item) : null);
  if (items.some((item) => item === null)) return null;
  const parsedItems = items as NewLinkBatchConfirmRequest[];
  if (parsedItems.some((item) => item.dataDate !== dataDate || item.reason !== reason)) return null;
  const totalCount = parsedItems.reduce((sum, item) => sum + item.count, 0);
  if (totalCount > MAX_NEW_LINK_BATCH_MULTI_TOTAL_COUNT) return null;
  const parsedRequest: NewLinkBatchMultiConfirmRequest = {
    safetyVersion: NEW_LINK_BATCH_CONFIRMATION_VERSION,
    workflowName: NEW_LINK_BATCH_WORKFLOW_NAME,
    mode: 'multi-source',
    items: parsedItems,
    dataDate,
    reason,
    ...(continuation ? { continuation } : {}),
  };
  if (!hasValidConfirmationKey(value, parsedRequest as unknown as Record<string, unknown>)) return null;
  return parsedRequest;
}

function isSafeMissingSourceCopyResult(result: Awaited<ReturnType<RentalPriceSkillClient['copy']>>): boolean {
  if (result.ok || result.sideEffectPossible === true || result.retrySafe === false) return false;
  return /Product not found/i.test(result.message ?? result.lines.join('\n'));
}

function failedCopyItem(
  request: NewLinkBatchConfirmRequest,
  sourceProductId: string,
  completedCount: number,
  reason: string,
  lines: string[],
  options: { skipped: boolean; blocking: boolean },
): NewLinkBatchFailedItem {
  return {
    keyword: request.keyword,
    sourceProductId,
    requestedCount: request.count,
    completedCount,
    reason,
    skipped: options.skipped,
    blocking: options.blocking,
    lines,
  };
}

function isNonBlockingNewLinkFailure(result: NewLinkBatchExecutionResult): boolean {
  return Boolean(result.failedItems?.length && result.failedItems.every((item) => item.skipped && !item.blocking));
}

function copyResultStatusLabel(result: NewLinkBatchExecutionResult): string {
  if (result.ok) return '完成';
  return isNonBlockingNewLinkFailure(result) ? '跳过' : '失败';
}

export async function executeNewLinkBatchConfirmRequest(
  client: RentalPriceSkillClient,
  request: NewLinkBatchConfirmRequest,
): Promise<NewLinkBatchExecutionResult> {
  const newProductIds: string[] = [];
  const lines: string[] = [];
  const failedItems: NewLinkBatchFailedItem[] = [];
  const sourceIds = [request.sourceProductId, ...(request.fallbackSourceProductIds ?? [])]
    .filter((value, index, array) => array.indexOf(value) === index);
  let sourceIndex = 0;
  let activeSourceProductId = request.sourceProductId;

  for (let index = 1; index <= request.count;) {
    const sourceProductId = sourceIds[sourceIndex] ?? activeSourceProductId;
    try {
      const result = await client.copy(sourceProductId);
      const isUnknownCopy = result.status === 'unknown' || result.sideEffectPossible === true;
      const copyStatusLabel = result.ok ? '成功' : isUnknownCopy ? '状态未知' : '失败';
      lines.push(`${index}. ${copyStatusLabel}${result.newProductId ? `：新商品 ${result.newProductId}` : ''}`);
      if (!result.ok) {
        const nextSourceId = sourceIds[sourceIndex + 1];
        if (nextSourceId && isSafeMissingSourceCopyResult(result)) {
          failedItems.push(failedCopyItem(request, sourceProductId, newProductIds.length, result.message ?? 'Product not found', result.lines, { skipped: true, blocking: false }));
          lines.push(`源商品 ${sourceProductId} 未找到，已切换候选源 ${nextSourceId} 继续复制。`);
          sourceIndex += 1;
          activeSourceProductId = nextSourceId;
          continue;
        }
        if (isSafeMissingSourceCopyResult(result)) {
          failedItems.push(failedCopyItem(request, sourceProductId, newProductIds.length, result.message ?? 'Product not found', result.lines, { skipped: true, blocking: false }));
          lines.push(`源商品 ${sourceProductId} 未找到，已跳过该商品的剩余 ${request.count - newProductIds.length} 条复制。`);
          return {
            ok: false,
            text: `新链批量复制部分完成：源商品 ${sourceProductId}，成功 ${newProductIds.length}/${request.count} 条，跳过 1 个找不到的商品。\n${lines.join('\n')}\n${result.lines.join('\n')}`,
            newProductIds,
            completedCount: newProductIds.length,
            failedItems,
          };
        }
        const safetyNote = isUnknownCopy
          ? '\n注意：本次复制可能已经提交但未拿到新商品ID；为避免重复铺链，请先到后台核对，确认后再决定是否继续，当前确认卡不要直接重试。'
          : '';
        failedItems.push(failedCopyItem(request, sourceProductId, newProductIds.length, result.message ?? (result.lines.join('\n') || 'copy failed'), result.lines, { skipped: false, blocking: true }));
        return {
          ok: false,
          text: `新链批量复制中断：源商品 ${request.sourceProductId}，已完成 ${newProductIds.length}/${request.count} 条。\n${lines.join('\n')}\n${result.lines.join('\n')}${safetyNote}`,
          newProductIds,
          completedCount: newProductIds.length,
          failedItems,
        };
      }
      newProductIds.push(result.newProductId ?? 'unknown');
      index += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failedItems.push(failedCopyItem(request, sourceProductId, newProductIds.length, message, [message], { skipped: false, blocking: true }));
      return {
        ok: false,
        text: `新链批量复制失败：源商品 ${request.sourceProductId}，已完成 ${newProductIds.length}/${request.count} 条。\n${error instanceof Error ? error.message : String(error)}`,
        newProductIds,
        completedCount: newProductIds.length,
        failedItems,
      };
    }
  }

  const ids = newProductIds.length ? `\n新商品ID：${newProductIds.join('、')}` : '';
  return {
    ok: true,
    text: `新链批量复制完成：源商品 ${activeSourceProductId}，成功 ${request.count} 条。${ids}`,
    newProductIds,
    completedCount: request.count,
  };
}

export async function executeNewLinkBatchMultiConfirmRequest(
  client: RentalPriceSkillClient,
  request: NewLinkBatchMultiConfirmRequest,
): Promise<NewLinkBatchExecutionResult> {
  const newProductIds: string[] = [];
  const lines: string[] = [];
  const failedItems: NewLinkBatchFailedItem[] = [];
  let completedCount = 0;

  for (const item of request.items) {
    const result = await executeNewLinkBatchConfirmRequest(client, item);
    newProductIds.push(...result.newProductIds);
    completedCount += result.completedCount;
    failedItems.push(...(result.failedItems ?? []));
    lines.push(`【${item.keyword} / 源商品 ${item.sourceProductId}】${copyResultStatusLabel(result)}`);
    lines.push(result.text);
    if (!result.ok && !isNonBlockingNewLinkFailure(result)) {
      return {
        ok: false,
        text: `多商品新链批量复制中断，已完成 ${completedCount}/${request.items.reduce((sum, next) => sum + next.count, 0)} 条。\n${lines.join('\n')}`,
        newProductIds,
        completedCount,
        failedItems,
      };
    }
  }

  if (failedItems.length) {
    const skippedCount = failedItems.filter((item) => item.skipped && !item.blocking).length;
    return {
      ok: false,
      text: `多商品新链批量复制部分完成：${request.items.length} 个商品，成功 ${completedCount}/${request.items.reduce((sum, item) => sum + item.count, 0)} 条，跳过 ${skippedCount} 个找不到的商品。\n${lines.join('\n')}`,
      newProductIds,
      completedCount,
      failedItems,
    };
  }

  return {
    ok: true,
    text: `多商品新链批量复制完成：${request.items.length} 个商品，成功 ${completedCount} 条。\n${lines.join('\n')}`,
    newProductIds,
    completedCount,
  };
}
