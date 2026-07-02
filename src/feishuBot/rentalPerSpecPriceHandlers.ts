import { buildAgentToolConfirmCard, type AgentToolConfirmRequest } from '../agentRuntime/approvalCard.js';
import { saveAgentToolConfirmRequest } from './agentToolConfirmStore.js';
import type { BotResponse } from './types.js';
import type { RentalPriceSkillClient } from './rentalPrice.js';

const PRICE_FIELD_NAMES = new Set(['rent1day', 'rent2day', 'rent3day', 'rent4day', 'rent5day', 'rent7day', 'rent10day', 'rent15day', 'rent30day', 'rent60day', 'rent90day', 'rent180day', 'marketPrice', 'deposit', 'purchasePrice', 'costPrice', 'finalPayment']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function money(value: string | number): string {
  return Number(value).toFixed(2);
}

function readSpecFields(value: unknown): Record<string, Record<string, string>> | null {
  if (!isRecord(value)) return null;
  const specFields: Record<string, Record<string, string>> = {};
  for (const [specId, rawFields] of Object.entries(value)) {
    if (!isRecord(rawFields)) return null;
    const fields: Record<string, string> = {};
    for (const [field, rawValue] of Object.entries(rawFields)) {
      if (!PRICE_FIELD_NAMES.has(field) || (typeof rawValue !== 'string' && typeof rawValue !== 'number') || !Number.isFinite(Number(rawValue))) continue;
      fields[field] = money(rawValue);
    }
    if (Object.keys(fields).length) specFields[specId] = fields;
  }
  return Object.keys(specFields).length ? specFields : null;
}

function readSpecPrices(value: unknown): Record<string, Record<string, string>> | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const specFields: Record<string, Record<string, string>> = {};
  for (const item of value) {
    if (!isRecord(item)) return null;
    const specId = readString(item.specId);
    const fields = readSpecFields(specId ? { [specId]: item.fields } : undefined)?.[specId ?? ''];
    if (!specId || !fields) return null;
    specFields[specId] = fields;
  }
  return specFields;
}

function formatPreviewLines(currentValues: Record<string, Record<string, string>>, specFields: Record<string, Record<string, string>>): string[] {
  return Object.entries(specFields).flatMap(([specId, fields]) => Object.entries(fields).map(([field, value]) => {
    const current = currentValues[specId]?.[field] ?? '未知';
    return `- ${specId} ${field}: ${current} -> ${value}`;
  }));
}

export async function rentalPerSpecPricePlanResponse(
  args: Record<string, unknown>,
  reason: string,
  client: RentalPriceSkillClient,
  outputDir: string,
  continuation?: AgentToolConfirmRequest['continuation'],
): Promise<BotResponse> {
  const productId = readString(args.productId);
  const specFields = readSpecPrices(args.specPrices);
  if (!productId || !specFields) return { text: '按规格改价参数无效：需要 productId 和 specPrices。', metadata: { toolName: 'rental.perSpecPricePlan', ok: false } };
  if (!client.read) return { text: '当前租赁改价客户端还没有接入只读价格读取能力，无法生成按规格改价预览。', metadata: { toolName: 'rental.perSpecPricePlan', ok: false, productId } };

  const current = await client.read(productId);
  if (!current.ok) return { text: `按规格改价预览失败：商品 ${productId}\n${current.lines.join('\n')}`, metadata: { toolName: 'rental.perSpecPricePlan', ok: false, productId } };
  const confirmRequest: AgentToolConfirmRequest = {
    toolName: 'rental.perSpecPriceApply',
    arguments: { productId, specFields },
    reason,
    ...(continuation ? { continuation } : {}),
  };
  const requestRef = await saveAgentToolConfirmRequest(outputDir, confirmRequest);
  return {
    text: [
      `按规格改价预览：商品 ${productId}`,
      '',
      ...formatPreviewLines(current.values, specFields),
      '',
      '安全边界：只写上述 specId 的绝对值；确认前不会改价。',
    ].join('\n'),
    card: buildAgentToolConfirmCard(confirmRequest, { requestRef }),
    metadata: { toolName: 'rental.perSpecPricePlan', ok: true, productId, specIds: Object.keys(specFields) },
  };
}

export async function rentalPerSpecPriceApplyResponse(args: Record<string, unknown>, client: RentalPriceSkillClient, ledgerContext?: { runId?: string; decisionId?: string; subject?: string }): Promise<BotResponse> {
  const productId = readString(args.productId);
  const specFields = readSpecFields(args.specFields);
  if (!productId || !specFields) throw new Error('按规格改价执行参数无效，请重新发起预览。');
  if (!client.applyPerSpec) throw new Error('当前租赁改价客户端不支持按规格改价。');
  const result = await client.applyPerSpec(productId, specFields);
  return {
    text: `${result.ok ? '按规格改价成功' : '按规格改价失败'}：商品 ${result.productId}\n${result.lines.join('\n')}`,
    metadata: { toolName: 'rental.perSpecPriceApply', ok: result.ok, productId: result.productId, resultFile: result.audit?.resultFile, ...(ledgerContext ? { ledgerContext } : {}) },
  };
}
