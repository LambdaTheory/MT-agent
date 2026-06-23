import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  ClosedOrderFeedbackInput,
  ClosedOrderIngestBatchResult,
  ClosedOrderIngestState,
  ClosedOrderIngestedRecord,
} from './types.js';

const CLOSED_ORDER_INGEST_STATE_VERSION = 1;

function normalizeText(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function normalizeRemarkForDedupe(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeInput(input: ClosedOrderFeedbackInput): ClosedOrderFeedbackInput {
  return {
    internalProductId: normalizeText(input.internalProductId) ?? '',
    rawRemark: input.rawRemark,
    ...(normalizeText(input.closeId) ? { closeId: normalizeText(input.closeId) } : {}),
    ...(normalizeText(input.closedAt) ? { closedAt: normalizeText(input.closedAt) } : {}),
    ...(normalizeText(input.orderNo) ? { orderNo: normalizeText(input.orderNo) } : {}),
    ...(normalizeText(input.merchant) ? { merchant: normalizeText(input.merchant) } : {}),
  };
}

function preferredValue(existing: string | undefined, incoming: string | undefined): string | undefined {
  return normalizeText(incoming) ?? normalizeText(existing);
}

function preferredRemark(existing: string, incoming: string): string {
  return normalizeText(incoming) ? incoming : existing;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseIngestedRecord(value: unknown): ClosedOrderIngestedRecord {
  if (!isObject(value)) throw new Error('Invalid closed order ingest item: expected object');
  if (typeof value.dedupeKey !== 'string' || value.dedupeKey.trim() === '') {
    throw new Error('Invalid closed order ingest item: dedupeKey');
  }
  if (typeof value.internalProductId !== 'string') throw new Error('Invalid closed order ingest item: internalProductId');
  if (typeof value.rawRemark !== 'string') throw new Error('Invalid closed order ingest item: rawRemark');
  if (typeof value.firstIngestedAt !== 'string' || value.firstIngestedAt.trim() === '') {
    throw new Error('Invalid closed order ingest item: firstIngestedAt');
  }
  if (typeof value.lastIngestedAt !== 'string' || value.lastIngestedAt.trim() === '') {
    throw new Error('Invalid closed order ingest item: lastIngestedAt');
  }
  if (typeof value.seenCount !== 'number' || !Number.isInteger(value.seenCount) || value.seenCount <= 0) {
    throw new Error('Invalid closed order ingest item: seenCount');
  }
  const seenCount = value.seenCount;

  const normalized = normalizeInput({
    internalProductId: value.internalProductId,
    rawRemark: value.rawRemark,
    ...(typeof value.closeId === 'string' ? { closeId: value.closeId } : {}),
    ...(typeof value.closedAt === 'string' ? { closedAt: value.closedAt } : {}),
    ...(typeof value.orderNo === 'string' ? { orderNo: value.orderNo } : {}),
    ...(typeof value.merchant === 'string' ? { merchant: value.merchant } : {}),
  });

  return {
    dedupeKey: value.dedupeKey.trim(),
    internalProductId: normalized.internalProductId,
    rawRemark: normalized.rawRemark,
    firstIngestedAt: value.firstIngestedAt.trim(),
    lastIngestedAt: value.lastIngestedAt.trim(),
    seenCount,
    ...(normalized.closeId ? { closeId: normalized.closeId } : {}),
    ...(normalized.closedAt ? { closedAt: normalized.closedAt } : {}),
    ...(normalized.orderNo ? { orderNo: normalized.orderNo } : {}),
    ...(normalized.merchant ? { merchant: normalized.merchant } : {}),
  };
}

export function createEmptyClosedOrderIngestState(): ClosedOrderIngestState {
  return {
    version: CLOSED_ORDER_INGEST_STATE_VERSION,
    items: [],
  };
}

export function parseClosedOrderIngestState(value: unknown): ClosedOrderIngestState {
  if (!isObject(value)) throw new Error('Invalid closed order ingest state: expected object');
  if (value.version !== CLOSED_ORDER_INGEST_STATE_VERSION) {
    throw new Error(`Invalid closed order ingest state version: ${String(value.version)}`);
  }
  if (!Array.isArray(value.items)) throw new Error('Invalid closed order ingest state: items must be an array');
  return {
    version: CLOSED_ORDER_INGEST_STATE_VERSION,
    items: value.items.map(parseIngestedRecord),
  };
}

export function buildClosedOrderIngestDedupeKey(input: ClosedOrderFeedbackInput): string {
  const normalized = normalizeInput(input);
  const closeId = normalizeText(normalized.closeId);
  if (closeId) return `close:${closeId}`;

  const digest = createHash('sha1')
    .update(JSON.stringify({
      internalProductId: normalizeText(normalized.internalProductId) ?? '',
      closedAt: normalizeText(normalized.closedAt) ?? '',
      orderNo: normalizeText(normalized.orderNo) ?? '',
      merchant: normalizeText(normalized.merchant) ?? '',
      rawRemark: normalizeRemarkForDedupe(normalized.rawRemark),
    }))
    .digest('hex')
    .slice(0, 16);
  return `remark:${digest}`;
}

function createIngestedRecord(input: ClosedOrderFeedbackInput, ingestedAt: string): ClosedOrderIngestedRecord {
  const normalized = normalizeInput(input);
  return {
    dedupeKey: buildClosedOrderIngestDedupeKey(normalized),
    internalProductId: normalized.internalProductId,
    rawRemark: normalized.rawRemark,
    firstIngestedAt: ingestedAt,
    lastIngestedAt: ingestedAt,
    seenCount: 1,
    ...(normalized.closeId ? { closeId: normalized.closeId } : {}),
    ...(normalized.closedAt ? { closedAt: normalized.closedAt } : {}),
    ...(normalized.orderNo ? { orderNo: normalized.orderNo } : {}),
    ...(normalized.merchant ? { merchant: normalized.merchant } : {}),
  };
}

function mergeIngestedRecord(
  existing: ClosedOrderIngestedRecord,
  input: ClosedOrderFeedbackInput,
  ingestedAt: string,
): ClosedOrderIngestedRecord {
  const normalized = normalizeInput(input);
  return {
    dedupeKey: existing.dedupeKey,
    internalProductId: preferredValue(existing.internalProductId, normalized.internalProductId) ?? '',
    rawRemark: preferredRemark(existing.rawRemark, normalized.rawRemark),
    firstIngestedAt: existing.firstIngestedAt,
    lastIngestedAt: ingestedAt,
    seenCount: existing.seenCount + 1,
    ...(preferredValue(existing.closeId, normalized.closeId) ? { closeId: preferredValue(existing.closeId, normalized.closeId) } : {}),
    ...(preferredValue(existing.closedAt, normalized.closedAt) ? { closedAt: preferredValue(existing.closedAt, normalized.closedAt) } : {}),
    ...(preferredValue(existing.orderNo, normalized.orderNo) ? { orderNo: preferredValue(existing.orderNo, normalized.orderNo) } : {}),
    ...(preferredValue(existing.merchant, normalized.merchant) ? { merchant: preferredValue(existing.merchant, normalized.merchant) } : {}),
  };
}

export async function loadClosedOrderIngestState(path: string): Promise<ClosedOrderIngestState> {
  try {
    return parseClosedOrderIngestState(JSON.parse(await readFile(path, 'utf8')) as unknown);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return createEmptyClosedOrderIngestState();
    }
    throw error;
  }
}

export async function saveClosedOrderIngestState(path: string, state: ClosedOrderIngestState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function ingestClosedOrderFeedbackInputs(
  state: ClosedOrderIngestState,
  inputs: readonly ClosedOrderFeedbackInput[],
  ingestedAt = new Date().toISOString(),
): ClosedOrderIngestBatchResult {
  const nextState: ClosedOrderIngestState = {
    version: CLOSED_ORDER_INGEST_STATE_VERSION,
    items: [...state.items],
  };
  const recordIndex = new Map(nextState.items.map((item, index) => [item.dedupeKey, index]));
  let addedCount = 0;
  let updatedCount = 0;

  for (const input of inputs) {
    const dedupeKey = buildClosedOrderIngestDedupeKey(input);
    const existingIndex = recordIndex.get(dedupeKey);
    if (existingIndex === undefined) {
      nextState.items.push(createIngestedRecord(input, ingestedAt));
      recordIndex.set(dedupeKey, nextState.items.length - 1);
      addedCount += 1;
      continue;
    }

    nextState.items[existingIndex] = mergeIngestedRecord(nextState.items[existingIndex], input, ingestedAt);
    updatedCount += 1;
  }

  return {
    state: nextState,
    addedCount,
    updatedCount,
  };
}
