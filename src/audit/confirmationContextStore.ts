import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseAuditConfig } from './config.js';
import type { AuditEntity, AuditSource } from './types.js';

export const CONFIRMATION_CONTEXT_SCHEMA_VERSION = 'agent_tool_confirmation_context:v1';
export const DEFAULT_CONFIRMATION_CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;

export type ConfirmationAuditToolName = 'publicTraffic.runReport' | 'publicTraffic.refreshDashboard';

export interface ConfirmationContextRecord {
  schemaVersion: typeof CONFIRMATION_CONTEXT_SCHEMA_VERSION;
  traceId: string;
  toolName: ConfirmationAuditToolName;
  requestRef?: string;
  createdAt: string;
  expiresAt: string;
  source: AuditSource;
  entity?: AuditEntity;
  initiatorUserId?: string;
}

export interface SaveConfirmationContextInput {
  confirmationKey: string;
  traceId: string;
  toolName: ConfirmationAuditToolName;
  requestRef?: string;
  source: AuditSource;
  entity?: AuditEntity;
  initiatorUserId?: string;
}

export interface ConfirmationContextStoreOptions {
  baseDir?: string;
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => Date;
  ttlMs?: number;
}

const lookupPrefix = `${CONFIRMATION_CONTEXT_SCHEMA_VERSION}:`;
const safeIdentifierPattern = /^[A-Za-z0-9._-]+$/;
const confirmationKeyPattern = /^[a-f0-9]{24}$/i;
const requestRefPattern = /^[A-Za-z0-9_-]{12,96}$/;
const pseudonymizedUserIdPattern = /^usr_[a-f0-9]{32}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const selectedConfirmationTools = new Set<string>(['publicTraffic.runReport', 'publicTraffic.refreshDashboard']);
const auditSources = new Set<string>(['feishu', 'agent', 'api', 'cli', 'scheduler', 'unknown']);
const saveInputKeys = new Set(['confirmationKey', 'traceId', 'toolName', 'requestRef', 'source', 'entity', 'initiatorUserId']);
const recordKeys = new Set(['schemaVersion', 'traceId', 'toolName', 'requestRef', 'createdAt', 'expiresAt', 'source', 'entity', 'initiatorUserId']);

export function confirmationContextLookupId(confirmationKey: string): string {
  const key = validateConfirmationKeyForWrite(confirmationKey);
  return sha256(`${lookupPrefix}${key}`);
}

export function confirmationContextPath(baseDir: string, confirmationKey: string): string {
  return join(validateBaseDir(baseDir), 'confirmation-contexts', `${confirmationContextLookupId(confirmationKey)}.json`);
}

export async function saveConfirmationContext(input: unknown, options: ConfirmationContextStoreOptions = {}): Promise<ConfirmationContextRecord> {
  const parsed = parseSaveInput(input);
  const now = currentDate(options);
  const ttlMs = validateTtlMs(options.ttlMs ?? DEFAULT_CONFIRMATION_CONTEXT_TTL_MS);
  const record: ConfirmationContextRecord = {
    schemaVersion: CONFIRMATION_CONTEXT_SCHEMA_VERSION,
    traceId: parsed.traceId,
    toolName: parsed.toolName,
    ...(parsed.requestRef !== undefined ? { requestRef: parsed.requestRef } : {}),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    source: parsed.source,
    ...(parsed.entity !== undefined ? { entity: parsed.entity } : {}),
    ...(parsed.initiatorUserId !== undefined ? { initiatorUserId: parsed.initiatorUserId } : {}),
  };
  const path = confirmationContextPath(resolveBaseDir(options), parsed.confirmationKey);
  await writeJsonAtomically(path, record);
  return Object.freeze(record);
}

export async function loadConfirmationContext(confirmationKey: string, options: ConfirmationContextStoreOptions = {}): Promise<ConfirmationContextRecord | undefined> {
  const path = confirmationContextPathForRead(confirmationKey, options);
  if (path === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    if (isMissingOrInvalidRead(error)) return undefined;
    return undefined;
  }
  const record = parseStoredRecord(parsed);
  if (record === undefined) return undefined;
  if (Date.parse(record.expiresAt) <= currentDate(options).getTime()) return undefined;
  return record;
}

function parseSaveInput(input: unknown): SaveConfirmationContextInput {
  if (!isRecord(input)) throw confirmationContextError('input');
  assertOnlyKeys(input, saveInputKeys, 'input');
  const confirmationKey = validateConfirmationKeyForWrite(input.confirmationKey);
  const traceId = validateSafeIdentifier(input.traceId, 'traceId');
  const toolName = validateToolName(input.toolName);
  const requestRef = input.requestRef === undefined ? undefined : validateRequestRef(input.requestRef);
  const source = validateSource(input.source);
  const entity = input.entity === undefined ? undefined : validateEntity(input.entity);
  const initiatorUserId = input.initiatorUserId === undefined ? undefined : validateInitiatorUserId(input.initiatorUserId);
  return {
    confirmationKey,
    traceId,
    toolName,
    ...(requestRef !== undefined ? { requestRef } : {}),
    source,
    ...(entity !== undefined ? { entity } : {}),
    ...(initiatorUserId !== undefined ? { initiatorUserId } : {}),
  };
}

function parseStoredRecord(value: unknown): ConfirmationContextRecord | undefined {
  if (!isRecord(value)) return undefined;
  if (!Object.keys(value).every((key) => recordKeys.has(key))) return undefined;
  if (value.schemaVersion !== CONFIRMATION_CONTEXT_SCHEMA_VERSION) return undefined;
  const traceId = parseSafeIdentifier(value.traceId);
  const toolName = parseToolName(value.toolName);
  const requestRef = value.requestRef === undefined ? undefined : parseRequestRef(value.requestRef);
  const createdAt = parseStrictIso(value.createdAt);
  const expiresAt = parseStrictIso(value.expiresAt);
  const source = parseSource(value.source);
  const entity = value.entity === undefined ? undefined : parseEntity(value.entity);
  const initiatorUserId = value.initiatorUserId === undefined ? undefined : parseInitiatorUserId(value.initiatorUserId);
  if (
    traceId === undefined ||
    toolName === undefined ||
    requestRef === null ||
    createdAt === undefined ||
    expiresAt === undefined ||
    source === undefined ||
    entity === null ||
    initiatorUserId === null
  ) {
    return undefined;
  }
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) return undefined;
  return Object.freeze({
    schemaVersion: CONFIRMATION_CONTEXT_SCHEMA_VERSION,
    traceId,
    toolName,
    ...(requestRef !== undefined ? { requestRef } : {}),
    createdAt,
    expiresAt,
    source,
    ...(entity !== undefined ? { entity } : {}),
    ...(initiatorUserId !== undefined ? { initiatorUserId } : {}),
  });
}

async function writeJsonAtomically(path: string, record: ConfirmationContextRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const file = await open(tempPath, 'w');
  try {
    await file.writeFile(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function confirmationContextPathForRead(confirmationKey: string, options: ConfirmationContextStoreOptions): string | undefined {
  const key = parseConfirmationKey(confirmationKey);
  if (key === undefined) return undefined;
  return join(resolveBaseDir(options), 'confirmation-contexts', `${sha256(`${lookupPrefix}${key}`)}.json`);
}

function resolveBaseDir(options: ConfirmationContextStoreOptions): string {
  if (options.baseDir !== undefined) return validateBaseDir(options.baseDir);
  return parseAuditConfig(options.env ?? process.env).logDir;
}

function validateBaseDir(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw confirmationContextError('baseDir');
  return trimmed;
}

function currentDate(options: ConfirmationContextStoreOptions): Date {
  const value = options.now?.() ?? new Date();
  if (!Number.isFinite(value.getTime())) throw confirmationContextError('now');
  return value;
}

function validateTtlMs(value: number): number {
  if (!Number.isInteger(value) || value <= 0) throw confirmationContextError('ttlMs');
  return value;
}

function validateConfirmationKeyForWrite(value: unknown): string {
  const key = parseConfirmationKey(value);
  if (key === undefined) throw confirmationContextError('confirmationKey');
  return key;
}

function parseConfirmationKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().toLowerCase();
  return confirmationKeyPattern.test(trimmed) ? trimmed : undefined;
}

function validateSafeIdentifier(value: unknown, name: string): string {
  const parsed = parseSafeIdentifier(value);
  if (parsed === undefined) throw confirmationContextError(name);
  return parsed;
}

function parseSafeIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || !safeIdentifierPattern.test(trimmed) || trimmed === '.' || trimmed === '..' || hasRawFeishuId(trimmed)) return undefined;
  return trimmed;
}

function validateToolName(value: unknown): ConfirmationAuditToolName {
  const parsed = parseToolName(value);
  if (parsed === undefined) throw confirmationContextError('toolName');
  return parsed;
}

function parseToolName(value: unknown): ConfirmationAuditToolName | undefined {
  if (typeof value !== 'string' || !selectedConfirmationTools.has(value)) return undefined;
  return value as ConfirmationAuditToolName;
}

function validateRequestRef(value: unknown): string {
  const parsed = parseRequestRef(value);
  if (parsed === null || parsed === undefined) throw confirmationContextError('requestRef');
  return parsed;
}

function parseRequestRef(value: unknown): string | undefined | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!requestRefPattern.test(trimmed) || hasRawFeishuId(trimmed)) return null;
  return trimmed;
}

function validateSource(value: unknown): AuditSource {
  const parsed = parseSource(value);
  if (parsed === undefined) throw confirmationContextError('source');
  return parsed;
}

function parseSource(value: unknown): AuditSource | undefined {
  if (typeof value !== 'string' || !auditSources.has(value)) return undefined;
  return value as AuditSource;
}

function validateEntity(value: unknown): AuditEntity {
  const parsed = parseEntity(value);
  if (parsed === null || parsed === undefined) throw confirmationContextError('entity');
  return parsed;
}

function parseEntity(value: unknown): AuditEntity | undefined | null {
  if (!isRecord(value)) return null;
  if (Object.keys(value).some((key) => key !== 'type' && key !== 'id')) return null;
  if (value.type !== 'report' || typeof value.id !== 'string') return null;
  const id = value.id.trim();
  if ((!isStrictBusinessDate(id) && !uuidPattern.test(id)) || id.includes('/') || id.includes('\\') || id.includes(':') || id === '.' || id === '..') return null;
  return { type: 'report', id };
}

function validateInitiatorUserId(value: unknown): string {
  const parsed = parseInitiatorUserId(value);
  if (parsed === null || parsed === undefined) throw confirmationContextError('initiatorUserId');
  return parsed;
}

function parseInitiatorUserId(value: unknown): string | undefined | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return pseudonymizedUserIdPattern.test(trimmed) ? trimmed : null;
}

function parseStrictIso(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? value : undefined;
}

function isStrictBusinessDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const yearValue = match[1];
  const monthValue = match[2];
  const dayValue = match[3];
  if (yearValue === undefined || monthValue === undefined || dayValue === undefined) return false;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function assertOnlyKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>, name: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw confirmationContextError(`${name}.${key}`);
  }
}

function isMissingOrInvalidRead(error: unknown): boolean {
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
  return code === 'ENOENT' || error instanceof SyntaxError || code !== undefined;
}

function hasRawFeishuId(value: string): boolean {
  return /(?:^|[^A-Za-z0-9])(?:ou|oc|om|on)_[A-Za-z0-9._-]+\b/.test(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function confirmationContextError(name: string): Error {
  return new Error(`Invalid confirmation context: ${name}`);
}
