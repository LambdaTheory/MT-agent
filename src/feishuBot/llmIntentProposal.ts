import type { BotIntent } from './types.js';

export type LlmProposableIntentName =
  | 'rental_price_change'
  | 'rental_copy'
  | 'rental_delist'
  | 'rental_tenancy_set'
  | 'rental_spec_discover'
  | 'rental_spec_add'
  | 'none';

export interface LlmIntentProposalRequest {
  message: string;
  intents: Array<{ name: Exclude<LlmProposableIntentName, 'none'>; description: string; argumentsSchema: Record<string, unknown> }>;
}

export interface LlmIntentProposalProvider {
  proposeIntent(request: LlmIntentProposalRequest): Promise<string>;
}

export interface LlmIntentProposal {
  intent: BotIntent;
  confidence: number;
  reason: string;
}

export type ParsedLlmIntentProposal =
  | { ok: true; proposal: LlmIntentProposal }
  | { ok: false; reason: 'invalid_json' | 'invalid_shape' | 'unsafe_intent' | 'invalid_arguments' };

const supportedIntentNames = new Set<string>([
  'rental_price_change',
  'rental_copy',
  'rental_delist',
  'rental_tenancy_set',
  'rental_spec_discover',
  'rental_spec_add',
  'none',
]);

const priceFieldNames = new Set(['rent1day', 'rent2day', 'rent3day', 'rent4day', 'rent5day', 'rent7day', 'rent10day', 'rent15day', 'rent30day', 'rent60day', 'rent90day', 'rent180day', 'marketPrice', 'deposit', 'purchasePrice', 'costPrice', 'finalPayment']);

export function getSupportedLlmIntentProposals(): LlmIntentProposalRequest['intents'] {
  return [
    {
      name: 'rental_price_change',
      description: '租赁商品改价。默认只改租金字段，例如 { rent1day: "22.00" }。marketPrice、deposit、purchasePrice、costPrice、finalPayment 只有在用户精准点名该字段时才允许放入 fields。只生成确认卡，不直接执行。',
      argumentsSchema: { type: 'object', required: ['productId', 'fields'] },
    },
    {
      name: 'rental_copy',
      description: '复制租赁商品。必须提供 productId。只生成确认卡，不直接执行。',
      argumentsSchema: { type: 'object', required: ['productId'] },
    },
    {
      name: 'rental_delist',
      description: '下架租赁商品。必须提供 productId。只生成确认卡，不直接执行。',
      argumentsSchema: { type: 'object', required: ['productId'] },
    },
    {
      name: 'rental_tenancy_set',
      description: '设置租赁商品租期。必须提供 productId 和 days，例如 "1,10,30"。只生成确认卡，不直接执行。',
      argumentsSchema: { type: 'object', required: ['productId', 'days'] },
    },
    {
      name: 'rental_spec_discover',
      description: '查看租赁商品规格。必须提供 productId。调用外部 daemon 前先生成确认卡。',
      argumentsSchema: { type: 'object', required: ['productId'] },
    },
    {
      name: 'rental_spec_add',
      description: '添加租赁商品规格项。必须提供 productId、specDimId 和 itemTitle。只生成确认卡，不直接执行。',
      argumentsSchema: { type: 'object', required: ['productId', 'specDimId', 'itemTitle'] },
    },
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readProductId(value: Record<string, unknown>): string | null {
  const raw = value.productId;
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) return raw.trim();
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return String(raw);
  return null;
}

function money(value: string | number): string | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : null;
}

function readFields(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const fields: Record<string, string> = {};
  for (const [field, raw] of Object.entries(value)) {
    if (!priceFieldNames.has(field)) continue;
    if (typeof raw !== 'string' && typeof raw !== 'number') continue;
    const normalized = money(raw);
    if (normalized) fields[field] = normalized;
  }
  return Object.keys(fields).length ? fields : null;
}

function readDays(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = value.replace(/[，、\s]+/g, ',').replace(/天/g, '').replace(/^,+|,+$/g, '');
    return /^\d+(?:,\d+)*$/.test(normalized) ? normalized : null;
  }
  if (Array.isArray(value)) {
    const days = value.map((item) => (typeof item === 'number' && Number.isInteger(item) ? String(item) : typeof item === 'string' && /^\d+天?$/.test(item.trim()) ? item.trim().replace(/天/g, '') : null));
    return days.every((item): item is string => item !== null) ? days.join(',') : null;
  }
  return null;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function proposalToIntent(intentName: LlmProposableIntentName, args: Record<string, unknown>): BotIntent | null {
  if (intentName === 'none') return { type: 'unknown', text: '' };
  const productId = readProductId(args);
  if (!productId) return null;

  switch (intentName) {
    case 'rental_price_change': {
      const fields = readFields(args.fields);
      return fields ? { type: 'rental_price_change', productId, request: { mode: 'explicit_fields', productId, fields } } : null;
    }
    case 'rental_copy':
      return { type: 'rental_copy', productId };
    case 'rental_delist':
      return { type: 'rental_delist', productId };
    case 'rental_tenancy_set': {
      const days = readDays(args.days);
      return days ? { type: 'rental_tenancy_set', productId, days } : null;
    }
    case 'rental_spec_discover':
      return { type: 'rental_spec_discover', productId };
    case 'rental_spec_add': {
      const specDimId = readNonEmptyString(args.specDimId);
      const itemTitle = readNonEmptyString(args.itemTitle);
      return specDimId && itemTitle ? { type: 'rental_spec_add', productId, specDimId, itemTitle } : null;
    }
  }
}

export function parseLlmIntentProposal(raw: string): ParsedLlmIntentProposal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }

  if (!isRecord(parsed)) return { ok: false, reason: 'invalid_shape' };
  const { intent, arguments: proposalArguments, confidence, reason } = parsed;
  if (typeof intent !== 'string' || !isRecord(proposalArguments) || typeof confidence !== 'number' || confidence < 0 || confidence > 1 || typeof reason !== 'string') {
    return { ok: false, reason: 'invalid_shape' };
  }
  if (!supportedIntentNames.has(intent)) return { ok: false, reason: 'unsafe_intent' };

  const botIntent = proposalToIntent(intent as LlmProposableIntentName, proposalArguments);
  if (!botIntent) return { ok: false, reason: 'invalid_arguments' };
  return { ok: true, proposal: { intent: botIntent, confidence, reason } };
}
