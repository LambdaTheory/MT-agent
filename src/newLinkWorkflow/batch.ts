import type { FeishuCardPayload } from '../notify/feishuApp.js';
import type { LinkRegistryEntry } from '../linkRegistry/types.js';
import type { PublicTrafficDataReportContext, PublicTrafficProductDataRow } from '../publicTraffic/types.js';
import type { RentalPriceSkillClient } from '../feishuBot/rentalPrice.js';

export const NEW_LINK_BATCH_WORKFLOW_NAME = 'rental.newLinkBatch';
export const MAX_NEW_LINK_BATCH_COUNT = 20;

export interface NewLinkBatchWorkflowRequest {
  keyword: string;
  count: number;
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
  selectedSource?: NewLinkBatchCandidate;
  candidates: NewLinkBatchCandidate[];
  warnings: string[];
}

export interface NewLinkBatchConfirmRequest {
  workflowName: typeof NEW_LINK_BATCH_WORKFLOW_NAME;
  keyword: string;
  count: number;
  sourceProductId: string;
  sourceProductName: string;
  dataDate: string;
  reason: string;
}

export interface NewLinkBatchExecutionResult {
  ok: boolean;
  text: string;
  newProductIds: string[];
  completedCount: number;
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

export function readNewLinkBatchWorkflowRequest(value: Record<string, unknown>): NewLinkBatchWorkflowRequest | null {
  const keyword = readString(value.keyword);
  const count = readPositiveInteger(value.count);
  return keyword && count ? { keyword, count } : null;
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
  const warnings: string[] = [];

  if (!keyword) warnings.push('缺少要铺新链的商品关键词。');
  if (!Number.isFinite(count) || count < 1 || count > MAX_NEW_LINK_BATCH_COUNT) warnings.push(`铺新链数量必须在 1-${MAX_NEW_LINK_BATCH_COUNT} 之间。`);

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

export function buildNewLinkBatchConfirmRequest(plan: NewLinkBatchPlan, reason: string): NewLinkBatchConfirmRequest | null {
  if (plan.status !== 'ready' || !plan.selectedSource) return null;
  return {
    workflowName: NEW_LINK_BATCH_WORKFLOW_NAME,
    keyword: plan.request.keyword,
    count: plan.request.count,
    sourceProductId: plan.selectedSource.productId,
    sourceProductName: plan.selectedSource.productName,
    dataDate: plan.dataDate,
    reason,
  };
}

export function buildNewLinkBatchConfirmCard(plan: NewLinkBatchPlan, reason: string): FeishuCardPayload | undefined {
  const request = buildNewLinkBatchConfirmRequest(plan, reason);
  if (!request || !plan.selectedSource) return undefined;
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
              behaviors: [{ type: 'callback', value: { action: 'new_link_batch_confirm', request } }],
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '取消' },
              type: 'default',
              form_action_type: 'submit',
              name: 'new_link_batch_cancel_submit',
              behaviors: [{ type: 'callback', value: { action: 'new_link_batch_cancel', keyword: request.keyword } }],
            },
          ],
        },
      ],
    },
  };
}

export function parseNewLinkBatchConfirmRequest(value: unknown): NewLinkBatchConfirmRequest | null {
  if (!isRecord(value) || !isRecord(value.request)) return null;
  const request = value.request;
  const workflowName = readString(request.workflowName);
  const keyword = readString(request.keyword);
  const count = readPositiveInteger(request.count);
  const sourceProductId = readString(request.sourceProductId);
  const sourceProductName = readString(request.sourceProductName);
  const dataDate = readString(request.dataDate);
  const reason = readString(request.reason);

  if (
    workflowName !== NEW_LINK_BATCH_WORKFLOW_NAME ||
    !keyword ||
    !count ||
    count > MAX_NEW_LINK_BATCH_COUNT ||
    !sourceProductId ||
    !/^\d+$/.test(sourceProductId) ||
    !sourceProductName ||
    !dataDate ||
    !reason
  ) {
    return null;
  }

  return { workflowName, keyword, count, sourceProductId, sourceProductName, dataDate, reason };
}

export async function executeNewLinkBatchConfirmRequest(
  client: RentalPriceSkillClient,
  request: NewLinkBatchConfirmRequest,
): Promise<NewLinkBatchExecutionResult> {
  const newProductIds: string[] = [];
  const lines: string[] = [];

  for (let index = 1; index <= request.count; index += 1) {
    try {
      const result = await client.copy(request.sourceProductId);
      lines.push(`${index}. ${result.ok ? '成功' : '失败'}${result.newProductId ? `：新商品 ${result.newProductId}` : ''}`);
      if (!result.ok) {
        return {
          ok: false,
          text: `新链批量复制中断：源商品 ${request.sourceProductId}，已完成 ${newProductIds.length}/${request.count} 条。\n${lines.join('\n')}\n${result.lines.join('\n')}`,
          newProductIds,
          completedCount: newProductIds.length,
        };
      }
      newProductIds.push(result.newProductId ?? 'unknown');
    } catch (error) {
      return {
        ok: false,
        text: `新链批量复制失败：源商品 ${request.sourceProductId}，已完成 ${newProductIds.length}/${request.count} 条。\n${error instanceof Error ? error.message : String(error)}`,
        newProductIds,
        completedCount: newProductIds.length,
      };
    }
  }

  const ids = newProductIds.length ? `\n新商品ID：${newProductIds.join('、')}` : '';
  return {
    ok: true,
    text: `新链批量复制完成：源商品 ${request.sourceProductId}，成功 ${request.count} 条。${ids}`,
    newProductIds,
    completedCount: request.count,
  };
}
