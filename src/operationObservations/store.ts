import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { mutateJsonFileSerialized } from '../linkRegistry/persistence.js';

export type OperationObservationType = 'price_change' | 'inactive_refresh' | 'goods_table_new_link';
export type OperationObservationStatus = 'observing' | 'historical_imported' | 'completed' | 'ignored';
export type OperationObservationOutcome = 'positive' | 'neutral' | 'negative' | 'insufficient_data';

export interface OperationObservationSubject {
  role: 'price_changed_product' | 'new_link' | 'delisted_old_link';
  productId: string;
  relatedProductId?: string;
  sourceProductId?: string;
}

export interface OperationObservationSource {
  toolName: 'rental.priceApply' | 'operations.inactiveRefreshExecute' | 'publicTraffic.goodsTableNewLink';
  taskId?: string;
  planRef?: string;
  auditPath?: string;
  planHash?: string;
  firstSeenDate?: string;
  platformProductId?: string;
  productName?: string;
}

export interface PriceChangeObservationDetails {
  fields: string[];
  changesFile?: string;
  rollbackFile?: string;
  currentValuesFile?: string;
}

export interface OperationObservation {
  observationId: string;
  operationType: OperationObservationType;
  status: OperationObservationStatus;
  createdAt: string;
  observeUntil: string;
  source: OperationObservationSource;
  sources?: OperationObservationSource[];
  subjects: OperationObservationSubject[];
  metricsToWatch: string[];
  priceChange?: PriceChangeObservationDetails;
}

export interface OperationObservationsStore {
  version: 1;
  observations: OperationObservation[];
}

export interface PriceChangeObservationInput {
  productId: string;
  fields: Record<string, string>;
  audit?: {
    taskId?: string;
    changesFile?: string;
    rollbackFile?: string;
    currentValuesFile?: string;
    planHash?: string;
  };
}

export interface InactiveRefreshObservationInput {
  planRef: string;
  auditPath: string;
  newProductIds: string[];
  delistedProductIds: string[];
  sourceProductIds: string[];
}

export interface GoodsTableNewLinkObservationInput {
  observedAt?: string;
  items: Array<{
    productId: string;
    platformProductId?: string;
    productName?: string;
    firstSeenDate: string;
  }>;
}

export interface OperationObservationMetricSnapshot {
  exposure?: number;
  visits?: number;
  orders?: number;
  amount?: number;
}

const OBSERVATION_DAYS = 14;

export function operationObservationsPath(outputDir: string): string {
  return join(outputDir, 'latest', 'operation-observations.json');
}

export async function loadOperationObservations(outputDir: string): Promise<OperationObservationsStore> {
  const path = operationObservationsPath(outputDir);
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return normalizeStore(parsed);
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return emptyStore();
    throw error;
  }
}

export async function upsertOperationObservations(outputDir: string, observations: OperationObservation[]): Promise<OperationObservationsStore> {
  const next = await mutateJsonFileSerialized<unknown>(operationObservationsPath(outputDir), emptyStore(), (current) => {
    const store = normalizeStore(current);
    const byId = new Map(store.observations.map((item) => [item.observationId, item]));
    for (const observation of observations) {
      const existing = findExistingNewLinkObservation(byId, observation);
      if (existing) byId.set(existing.observationId, mergeOperationObservation(existing, observation));
      else byId.set(observation.observationId, withSources(observation));
    }
    return { version: 1, observations: Array.from(byId.values()) };
  });
  return normalizeStore(next);
}

export async function recordPriceChangeObservation(outputDir: string, input: PriceChangeObservationInput): Promise<OperationObservation> {
  const observation = buildPriceChangeObservation(input, new Date());
  await upsertOperationObservations(outputDir, [observation]);
  return observation;
}

export async function recordInactiveRefreshObservations(outputDir: string, input: InactiveRefreshObservationInput): Promise<OperationObservation[]> {
  const now = new Date();
  const observations = input.newProductIds.map((newProductId, index) => {
    const delistedProductId = input.delistedProductIds[index];
    const sourceProductId = input.sourceProductIds[index] ?? input.sourceProductIds[0];
    return buildInactiveRefreshObservation({ ...input, newProductId, delistedProductId, sourceProductId, index }, now);
  });
  await upsertOperationObservations(outputDir, observations);
  return observations;
}

export async function recordGoodsTableNewLinkObservations(outputDir: string, input: GoodsTableNewLinkObservationInput): Promise<OperationObservation[]> {
  const now = input.observedAt ? new Date(input.observedAt) : new Date();
  const observations = input.items.map((item) => buildGoodsTableNewLinkObservation(item, now));
  await upsertOperationObservations(outputDir, observations);
  return observations;
}

export function evaluateOperationObservationOutcome(metrics: OperationObservationMetricSnapshot): OperationObservationOutcome {
  const values = [metrics.exposure, metrics.visits, metrics.orders, metrics.amount];
  if (values.every((value) => value === undefined)) return 'insufficient_data';
  if ((metrics.amount ?? 0) > 0 || (metrics.orders ?? 0) > 0) return 'positive';
  if ((metrics.exposure ?? 0) > 0 || (metrics.visits ?? 0) > 0) return 'neutral';
  return 'negative';
}

export async function loadActiveInactiveRefreshDelistedProductIds(outputDir: string, now = new Date()): Promise<Set<string>> {
  const store = await loadOperationObservations(outputDir);
  const nowMs = now.getTime();
  const productIds = new Set<string>();
  for (const observation of store.observations) {
    if (observation.operationType !== 'inactive_refresh' || observation.status !== 'observing') continue;
    const observeUntilMs = Date.parse(observation.observeUntil);
    if (!Number.isFinite(observeUntilMs) || observeUntilMs <= nowMs) continue;
    for (const subject of observation.subjects) {
      if (subject.role === 'delisted_old_link') productIds.add(subject.productId);
    }
  }
  return productIds;
}

function buildPriceChangeObservation(input: PriceChangeObservationInput, now: Date): OperationObservation {
  const createdAt = now.toISOString();
  const taskOrHash = input.audit?.taskId ?? input.audit?.planHash ?? hashStable([input.productId, input.fields]);
  return {
    observationId: `opobs_price_change_${input.productId}_${safeIdPart(taskOrHash)}`,
    operationType: 'price_change',
    status: 'observing',
    createdAt,
    observeUntil: observeUntil(now),
    source: {
      toolName: 'rental.priceApply',
      ...(input.audit?.taskId ? { taskId: input.audit.taskId } : {}),
      ...(input.audit?.planHash ? { planHash: input.audit.planHash } : {}),
    },
    subjects: [{ role: 'price_changed_product', productId: input.productId }],
    metricsToWatch: ['visits', 'orders', 'amount', 'conversion_rate'],
    priceChange: {
      fields: Object.keys(input.fields).sort(),
      ...(input.audit?.changesFile ? { changesFile: input.audit.changesFile } : {}),
      ...(input.audit?.rollbackFile ? { rollbackFile: input.audit.rollbackFile } : {}),
      ...(input.audit?.currentValuesFile ? { currentValuesFile: input.audit.currentValuesFile } : {}),
    },
  };
}

function buildInactiveRefreshObservation(input: InactiveRefreshObservationInput & { newProductId: string; delistedProductId?: string; sourceProductId?: string; index: number }, now: Date): OperationObservation {
  const createdAt = now.toISOString();
  const subjects: OperationObservationSubject[] = [
    {
      role: 'new_link',
      productId: input.newProductId,
      ...(input.delistedProductId ? { relatedProductId: input.delistedProductId } : {}),
      ...(input.sourceProductId ? { sourceProductId: input.sourceProductId } : {}),
    },
  ];
  if (input.delistedProductId) {
    subjects.push({
      role: 'delisted_old_link',
      productId: input.delistedProductId,
      relatedProductId: input.newProductId,
      ...(input.sourceProductId ? { sourceProductId: input.sourceProductId } : {}),
    });
  }
  return {
    observationId: `opobs_inactive_refresh_${safeIdPart(input.planRef)}_${input.index}_${safeIdPart(input.newProductId)}`,
    operationType: 'inactive_refresh',
    status: 'observing',
    createdAt,
    observeUntil: observeUntil(now),
    source: { toolName: 'operations.inactiveRefreshExecute', planRef: input.planRef, auditPath: input.auditPath },
    subjects,
    metricsToWatch: ['exposure', 'visits', 'orders', 'amount'],
  };
}

function buildGoodsTableNewLinkObservation(input: GoodsTableNewLinkObservationInput['items'][number], now: Date): OperationObservation {
  const createdAt = now.toISOString();
  return {
    observationId: `opobs_goods_table_new_link_${safeIdPart(input.productId)}`,
    operationType: 'goods_table_new_link',
    status: 'observing',
    createdAt,
    observeUntil: observeUntil(now),
    source: {
      toolName: 'publicTraffic.goodsTableNewLink',
      firstSeenDate: input.firstSeenDate,
      ...(input.platformProductId ? { platformProductId: input.platformProductId } : {}),
      ...(input.productName ? { productName: input.productName } : {}),
    },
    subjects: [{ role: 'new_link', productId: input.productId }],
    metricsToWatch: ['exposure', 'visits', 'orders', 'amount'],
  };
}

function newLinkProductId(observation: OperationObservation): string | null {
  return observation.subjects.find((subject) => subject.role === 'new_link')?.productId ?? null;
}

function findExistingNewLinkObservation(byId: Map<string, OperationObservation>, observation: OperationObservation): OperationObservation | null {
  const productId = newLinkProductId(observation);
  if (!productId) return null;
  for (const existing of byId.values()) {
    if (newLinkProductId(existing) === productId) return existing;
  }
  return null;
}

function withSources(observation: OperationObservation): OperationObservation {
  return { ...observation, sources: mergeSources(observation.sources ?? [], [observation.source]) };
}

function mergeOperationObservation(existing: OperationObservation, incoming: OperationObservation): OperationObservation {
  const existingWithSources = withSources(existing);
  const incomingWithSources = withSources(incoming);
  const incomingIsStronger = incoming.operationType === 'inactive_refresh' && existing.operationType !== 'inactive_refresh';
  const base = incomingIsStronger ? incomingWithSources : existingWithSources;
  const other = incomingIsStronger ? existingWithSources : incomingWithSources;
  return {
    ...base,
    observationId: existing.observationId,
    createdAt: earlierIso(existing.createdAt, incoming.createdAt),
    observeUntil: existing.observeUntil,
    source: base.source,
    sources: mergeSources(existingWithSources.sources ?? [], incomingWithSources.sources ?? []),
    subjects: mergeSubjects(other.subjects, base.subjects),
    metricsToWatch: mergeStrings(other.metricsToWatch, base.metricsToWatch),
  };
}

function mergeSources(left: OperationObservationSource[], right: OperationObservationSource[]): OperationObservationSource[] {
  const byKey = new Map<string, OperationObservationSource>();
  for (const source of [...left, ...right]) byKey.set(JSON.stringify(source), source);
  return Array.from(byKey.values());
}

function mergeSubjects(left: OperationObservationSubject[], right: OperationObservationSubject[]): OperationObservationSubject[] {
  const byKey = new Map<string, OperationObservationSubject>();
  for (const subject of [...left, ...right]) {
    const key = `${subject.role}:${subject.productId}`;
    byKey.set(key, { ...(byKey.get(key) ?? {}), ...subject });
  }
  return Array.from(byKey.values());
}

function mergeStrings(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right])];
}

function earlierIso(left: string, right: string): string {
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function observeUntil(now: Date): string {
  return new Date(now.getTime() + OBSERVATION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function emptyStore(): OperationObservationsStore {
  return { version: 1, observations: [] };
}

function normalizeStore(value: unknown): OperationObservationsStore {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.observations)) return emptyStore();
  return { version: 1, observations: value.observations.filter(isOperationObservation) };
}

function safeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function hashStable(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOperationObservation(value: unknown): value is OperationObservation {
  if (!isRecord(value)) return false;
  return typeof value.observationId === 'string' && (value.operationType === 'price_change' || value.operationType === 'inactive_refresh' || value.operationType === 'goods_table_new_link') && Array.isArray(value.subjects) && Array.isArray(value.metricsToWatch);
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
