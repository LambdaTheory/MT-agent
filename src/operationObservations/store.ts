import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

export type OperationObservationType = 'price_change' | 'inactive_refresh';
export type OperationObservationStatus = 'observing' | 'historical_imported' | 'completed' | 'ignored';

export interface OperationObservationSubject {
  role: 'price_changed_product' | 'new_link' | 'delisted_old_link';
  productId: string;
  relatedProductId?: string;
  sourceProductId?: string;
}

export interface OperationObservationSource {
  toolName: 'rental.priceApply' | 'operations.inactiveRefreshExecute';
  taskId?: string;
  planRef?: string;
  auditPath?: string;
  planHash?: string;
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

const OBSERVATION_DAYS = 14;

export function operationObservationsPath(outputDir: string): string {
  return join(outputDir, 'latest', 'operation-observations.json');
}

export async function loadOperationObservations(outputDir: string): Promise<OperationObservationsStore> {
  const path = operationObservationsPath(outputDir);
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.observations)) return emptyStore();
    return { version: 1, observations: parsed.observations.filter(isOperationObservation) };
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return emptyStore();
    throw error;
  }
}

export async function upsertOperationObservations(outputDir: string, observations: OperationObservation[]): Promise<OperationObservationsStore> {
  const store = await loadOperationObservations(outputDir);
  const byId = new Map(store.observations.map((item) => [item.observationId, item]));
  for (const observation of observations) byId.set(observation.observationId, observation);
  const next: OperationObservationsStore = { version: 1, observations: Array.from(byId.values()) };
  await writeOperationObservations(outputDir, next);
  return next;
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

async function writeOperationObservations(outputDir: string, store: OperationObservationsStore): Promise<void> {
  const path = operationObservationsPath(outputDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

function observeUntil(now: Date): string {
  return new Date(now.getTime() + OBSERVATION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function emptyStore(): OperationObservationsStore {
  return { version: 1, observations: [] };
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
  return typeof value.observationId === 'string' && (value.operationType === 'price_change' || value.operationType === 'inactive_refresh') && Array.isArray(value.subjects) && Array.isArray(value.metricsToWatch);
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
