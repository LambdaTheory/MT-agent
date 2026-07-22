import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, open, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AuditRetryCategory, AuditRetryReason, RetryItem } from './types.js';

export interface AuditStorageOptions {
  logDir: string;
  now?: () => Date;
  nowMs?: () => number;
  makeOwnerId?: () => string;
  lockRetryMs?: number;
  lockStaleMs?: number;
  lockAcquireTimeoutMs?: number;
  replayLeaseMs?: number;
  maxReadItems?: number;
  maxReadBytes?: number;
  staleTakeoverProbe?: (stage: 'before-remove-stale', lockPath: string) => void | Promise<void>;
}

export type AuditIsolateReason = 'status_400' | 'status_413' | 'status_415' | 'malformed_json' | 'schema_invalid' | 'invalid_payload';

export interface EnqueueAuditRetryInput {
  payload: string;
  reason: AuditRetryReason;
  category: AuditRetryCategory;
  attempts?: number;
}

export interface AuditRetryReadOptions {
  maxItems?: number;
  maxBytes?: number;
}

export interface AuditRetryReadResult {
  items: RetryItem[];
  badLines: number;
  truncated: boolean;
}

export interface AuditReplayLease {
  ownerId: string;
  lockPath: string;
  stillOwned: () => Promise<boolean>;
  renew: () => Promise<void>;
  release: () => Promise<void>;
}

export interface AuditRetryCompactionOptions {
  acceptedIds: ReadonlySet<string>;
  retriedIds?: ReadonlySet<string>;
  attemptedAt?: string;
  beforeCommit?: () => void | Promise<void>;
  lease?: AuditReplayLease;
}

export interface AuditRetryCompactionResult {
  removed: number;
  retained: number;
  updated: number;
  badLines: number;
}

export type AuditIsolateInput =
  | { source: 'send'; payload: string; reason: Extract<AuditIsolateReason, 'status_400' | 'status_413' | 'status_415'>; statusCode: 400 | 413 | 415 }
  | { source: 'bad-line'; lineHash: string; byteLength: number; reason: Extract<AuditIsolateReason, 'malformed_json' | 'schema_invalid' | 'invalid_payload'> };

export type AuditIsolateRecord =
  | {
    id: string;
    source: 'send';
    payload: string;
    payloadSha256: string;
    reason: Extract<AuditIsolateReason, 'status_400' | 'status_413' | 'status_415'>;
    statusCode: 400 | 413 | 415;
    isolatedAt: string;
  }
  | {
    id: string;
    source: 'bad-line';
    lineHash: string;
    byteLength: number;
    reason: Extract<AuditIsolateReason, 'malformed_json' | 'schema_invalid' | 'invalid_payload'>;
    isolatedAt: string;
  };

interface LockHandle {
  ownerId: string;
  token: string;
  lockPath: string;
  stillOwned: () => Promise<boolean>;
  renew: (expiresAt?: string) => Promise<void>;
  release: () => Promise<void>;
}

interface OwnerMetadata {
  ownerId: string;
  token: string;
  acquiredAt: string;
  expiresAt?: string;
}

type TimerHandle = ReturnType<typeof setInterval>;

const defaultLockRetryMs = 25;
const defaultLockStaleMs = 120_000;
const defaultLockAcquireTimeoutMs = 5_000;
const defaultReplayLeaseMs = 60_000;
const defaultMaxReadItems = 50;
const defaultMaxReadBytes = 2 * 1024 * 1024;
const maxReadItemsCap = 500;
const maxReadBytesCap = 4 * 1024 * 1024;
const controlledRetryReasons = new Set<AuditRetryReason>(['network', 'timeout', 'non_2xx', 'malformed_response', 'negative_ack']);
const controlledRetryCategories = new Set<AuditRetryCategory>(['transient', 'remote']);
const controlledSendIsolateReasons = new Set(['status_400', 'status_413', 'status_415']);
const controlledBadLineIsolateReasons = new Set(['malformed_json', 'schema_invalid', 'invalid_payload']);
const retryItemKeys = new Set(['id', 'payload', 'payloadSha256', 'reason', 'category', 'attempts', 'firstAttemptedAt', 'lastAttemptedAt']);

export function auditRawPath(logDir: string, now: Date): string {
  return join(logDir, `audit-${datePart(now)}.jsonl`);
}

export function auditRetryQueuePath(logDir: string): string {
  return join(logDir, 'retry-queue.jsonl');
}

export function auditIsolatePath(logDir: string, now: Date): string {
  return join(logDir, `isolate-${datePart(now)}.jsonl`);
}

export function auditReplayLeasePath(logDir: string): string {
  return join(logDir, 'replay.lease');
}

export async function appendRawAuditPayload(options: AuditStorageOptions, payload: string): Promise<void> {
  validateSingleLinePayload(payload, 'raw audit payload');
  const path = auditRawPath(options.logDir, currentDate(options));
  await mkdir(dirname(path), { recursive: true });
  const lock = await acquireDirectoryLock(`${path}.lock`, options);
  try {
    await withLockHeartbeat(lock, options, options.lockStaleMs ?? defaultLockStaleMs, undefined, async () => {
      await appendFile(path, `${payload}\n`, 'utf8');
    });
  } finally {
    await lock.release();
  }
}

export async function enqueueAuditRetry(options: AuditStorageOptions, input: EnqueueAuditRetryInput): Promise<RetryItem> {
  validateSingleLinePayload(input.payload, 'retry payload');
  if (!controlledRetryReasons.has(input.reason)) throw new Error('audit retry reason must be controlled');
  if (!controlledRetryCategories.has(input.category)) throw new Error('audit retry category must be controlled');
  const attempts = input.attempts ?? 0;
  if (!Number.isInteger(attempts) || attempts < 0) throw new Error('audit retry attempts must be a nonnegative integer');

  const now = currentIso(options);
  const payloadSha256 = sha256(input.payload);
  const item: RetryItem = {
    id: sha256(`${payloadSha256}\0${now}\0${randomUUID()}`),
    payload: input.payload,
    payloadSha256,
    reason: input.reason,
    category: input.category,
    attempts,
    firstAttemptedAt: now,
    lastAttemptedAt: now,
  };
  const path = auditRetryQueuePath(options.logDir);
  await mkdir(dirname(path), { recursive: true });
  const lock = await acquireDirectoryLock(`${path}.lock`, options);
  try {
    await withLockHeartbeat(lock, options, options.lockStaleMs ?? defaultLockStaleMs, undefined, async () => {
      await appendFile(path, `${JSON.stringify(item)}\n`, 'utf8');
    });
  } finally {
    await lock.release();
  }
  return item;
}

export async function readAuditRetryBatch(
  options: AuditStorageOptions,
  readOptions: AuditRetryReadOptions = {},
): Promise<AuditRetryReadResult> {
  const path = auditRetryQueuePath(options.logDir);
  const maxItems = boundedMaxItems(readOptions.maxItems ?? options.maxReadItems ?? defaultMaxReadItems);
  const maxBytes = boundedMaxBytes(readOptions.maxBytes ?? options.maxReadBytes ?? defaultMaxReadBytes);
  const { raw, truncated: readTruncated } = await readBoundedText(path, maxBytes);
  const result: AuditRetryReadResult = { items: [], badLines: 0, truncated: false };
  let consumedBytes = 0;

  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const lineBytes = Buffer.byteLength(`${line}\n`, 'utf8');
    if (consumedBytes + lineBytes > maxBytes) {
      result.truncated = true;
      break;
    }
    consumedBytes += lineBytes;
    const item = parseRetryItem(line);
    if (item === null) {
      result.badLines += 1;
      continue;
    }
    if (result.items.length >= maxItems) {
      result.truncated = true;
      break;
    }
    result.items.push(item);
  }
  if (readTruncated) result.truncated = true;
  return result;
}

export async function compactAuditRetryQueue(
  options: AuditStorageOptions,
  compaction: AuditRetryCompactionOptions,
): Promise<AuditRetryCompactionResult> {
  const path = auditRetryQueuePath(options.logDir);
  await mkdir(dirname(path), { recursive: true });
  const lock = await acquireDirectoryLock(`${path}.lock`, options);
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  try {
    return await withLockHeartbeat(lock, options, options.lockStaleMs ?? defaultLockStaleMs, undefined, async () => {
      await assertLeaseStillOwned(compaction.lease);
      const retriedIds = compaction.retriedIds ?? new Set<string>();
      const attemptedAt = validateAttemptedAt(compaction.attemptedAt, retriedIds);
      const raw = await readTextIfExists(path);
      const retainedItems: RetryItem[] = [];
      let removed = 0;
      let badLines = 0;
      let updated = 0;
      for (const line of raw.split('\n')) {
        if (line.length === 0) continue;
        const item = parseRetryItem(line);
        if (item === null) {
          badLines += 1;
          continue;
        }
        if (compaction.acceptedIds.has(item.id)) {
          removed += 1;
        } else {
          if (retriedIds.has(item.id)) {
            retainedItems.push({ ...item, attempts: item.attempts + 1, lastAttemptedAt: attemptedAt });
            updated += 1;
          } else {
            retainedItems.push(item);
          }
        }
      }
      const nextRaw = retainedItems.length > 0 ? `${retainedItems.map((item) => JSON.stringify(item)).join('\n')}\n` : '';
      const file = await open(tempPath, 'w');
      try {
        await file.writeFile(nextRaw, 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
      await compaction.beforeCommit?.();
      await assertLeaseStillOwned(compaction.lease);
      await rename(tempPath, path);
      return { removed, retained: retainedItems.length, updated, badLines };
    });
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await lock.release();
  }
}

function validateAttemptedAt(attemptedAt: string | undefined, retriedIds: ReadonlySet<string>): string {
  if (retriedIds.size === 0) return attemptedAt ?? new Date(0).toISOString();
  if (attemptedAt === undefined || !isStrictIso(attemptedAt)) throw new Error('audit retry attemptedAt must be strict ISO');
  return attemptedAt;
}

export async function isolateAuditPayload(options: AuditStorageOptions, input: AuditIsolateInput): Promise<AuditIsolateRecord> {
  const isolatedAt = currentIso(options);
  const record = buildIsolateRecord(input, isolatedAt);
  const path = auditIsolatePath(options.logDir, currentDate(options));
  await mkdir(dirname(path), { recursive: true });
  const lock = await acquireDirectoryLock(`${path}.lock`, options);
  try {
    await withLockHeartbeat(lock, options, options.lockStaleMs ?? defaultLockStaleMs, undefined, async () => {
      await appendFile(path, `${JSON.stringify(record)}\n`, 'utf8');
    });
  } finally {
    await lock.release();
  }
  return record;
}

export async function withAuditReplayLease<T>(
  options: AuditStorageOptions,
  action: (lease: AuditReplayLease) => Promise<T> | T,
): Promise<T | undefined> {
  const lease = await tryAcquireReplayLease(options);
  if (lease === undefined) return undefined;
  try {
    return await withLeaseHeartbeat(lease, options, async () => action(lease));
  } finally {
    await lease.release();
  }
}

async function tryAcquireReplayLease(options: AuditStorageOptions): Promise<AuditReplayLease | undefined> {
  const lockPath = auditReplayLeasePath(options.logDir);
  const replayLeaseMs = positiveInteger(options.replayLeaseMs ?? defaultReplayLeaseMs, 'replayLeaseMs');
  const nowMs = currentMs(options);
  const existing = await stat(lockPath).catch((error: unknown) => {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  });
  if (existing !== null && !await isLockStale(lockPath, replayLeaseMs, nowMs)) return undefined;
  const deadlineMs = currentMs(options) + positiveInteger(options.lockAcquireTimeoutMs ?? defaultLockAcquireTimeoutMs, 'lockAcquireTimeoutMs');
  if (existing !== null && !await recoverStaleLock(lockPath, replayLeaseMs, options, deadlineMs)) return undefined;
  try {
    const handle = await createLockHandle(lockPath, options, new Date(nowMs + replayLeaseMs).toISOString());
    return {
      ownerId: handle.ownerId,
      lockPath: handle.lockPath,
      stillOwned: handle.stillOwned,
      renew: () => handle.renew(new Date(currentMs(options) + replayLeaseMs).toISOString()),
      release: handle.release,
    };
  } catch (error) {
    if (errorCode(error) === 'EEXIST') return undefined;
    throw error;
  }
}

async function acquireDirectoryLock(lockPath: string, options: AuditStorageOptions): Promise<LockHandle> {
  const retryMs = positiveInteger(options.lockRetryMs ?? defaultLockRetryMs, 'lockRetryMs');
  const staleMs = positiveInteger(options.lockStaleMs ?? defaultLockStaleMs, 'lockStaleMs');
  const timeoutMs = positiveInteger(options.lockAcquireTimeoutMs ?? defaultLockAcquireTimeoutMs, 'lockAcquireTimeoutMs');
  const startedAt = currentMs(options);
  const deadlineMs = startedAt + timeoutMs;
  await mkdir(dirname(lockPath), { recursive: true });
  while (currentMs(options) <= deadlineMs) {
    try {
      return await createLockHandle(lockPath, options);
    } catch (error) {
      if (!isLockContentionError(error)) throw error;
      const lockStat = await stat(lockPath).catch((statError: unknown) => {
        if (errorCode(statError) === 'ENOENT') return null;
        throw statError;
      });
      if (lockStat === null) {
        if (currentMs(options) >= deadlineMs) throw new Error(`audit storage lock acquisition timed out: ${lockPath}`);
        await sleepUntilDeadline(retryMs, deadlineMs, options);
        continue;
      }
      if (currentMs(options) - lockStat.mtimeMs > staleMs) {
        const recovered = await recoverStaleLock(lockPath, staleMs, options, deadlineMs);
        if (!recovered && currentMs(options) >= deadlineMs) throw new Error(`audit storage lock acquisition timed out: ${lockPath}`);
        await sleepUntilDeadline(retryMs, deadlineMs, options);
        continue;
      }
      if (currentMs(options) >= deadlineMs) throw new Error(`audit storage lock acquisition timed out: ${lockPath}`);
      await sleepUntilDeadline(retryMs, deadlineMs, options);
    }
  }
  throw new Error(`audit storage lock acquisition timed out: ${lockPath}`);
}

async function recoverStaleLock(lockPath: string, staleMs: number, options: AuditStorageOptions, deadlineMs: number): Promise<boolean> {
  const takeoverPath = `${lockPath}.takeover`;
  const takeover = await acquireTakeoverMutex(takeoverPath, options, deadlineMs);
  if (takeover === undefined) return false;
  try {
    return await withLockHeartbeat(takeover, options, staleMs, undefined, async () => {
      if (!await isLockStale(lockPath, staleMs, currentMs(options))) return false;
      await options.staleTakeoverProbe?.('before-remove-stale', lockPath);
      if (!await isLockStale(lockPath, staleMs, currentMs(options))) return false;
      if (!await takeover.stillOwned()) return false;
      await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
      return true;
    });
  } finally {
    await takeover.release();
  }
}

async function acquireTakeoverMutex(lockPath: string, options: AuditStorageOptions, deadlineMs: number): Promise<LockHandle | undefined> {
  const retryMs = positiveInteger(options.lockRetryMs ?? defaultLockRetryMs, 'lockRetryMs');
  await mkdir(dirname(lockPath), { recursive: true });
  while (currentMs(options) < deadlineMs) {
    try {
      return await createLockHandle(lockPath, options);
    } catch (error) {
      if (!isLockContentionError(error)) throw error;
      await sleepUntilDeadline(retryMs, deadlineMs, options);
    }
  }
  return undefined;
}

async function withLockHeartbeat<T>(
  lock: LockHandle,
  options: AuditStorageOptions,
  durationMs: number,
  expiresAt: (() => string) | undefined,
  action: () => Promise<T>,
): Promise<T> {
  const intervalMs = heartbeatIntervalMs(durationMs);
  const timer = setInterval(() => {
    lock.renew(expiresAt?.()).catch(() => undefined);
  }, intervalMs);
  unrefTimer(timer);
  try {
    return await action();
  } finally {
    clearInterval(timer);
  }
}

async function withLeaseHeartbeat<T>(lease: AuditReplayLease, options: AuditStorageOptions, action: () => Promise<T> | T): Promise<T> {
  const replayLeaseMs = positiveInteger(options.replayLeaseMs ?? defaultReplayLeaseMs, 'replayLeaseMs');
  const intervalMs = heartbeatIntervalMs(replayLeaseMs);
  const timer = setInterval(() => {
    lease.renew().catch(() => undefined);
  }, intervalMs);
  unrefTimer(timer);
  try {
    return await action();
  } finally {
    clearInterval(timer);
  }
}

function heartbeatIntervalMs(durationMs: number): number {
  return Math.max(1, Math.floor(durationMs / 3));
}

function unrefTimer(timer: TimerHandle): void {
  const maybeTimer = timer as { unref?: () => void };
  maybeTimer.unref?.();
}

async function createLockHandle(lockPath: string, options: AuditStorageOptions, expiresAt?: string): Promise<LockHandle> {
  await mkdir(lockPath);
  const ownerId = ownerIdFor(options);
  const token = randomUUID();
  const metadata: OwnerMetadata = { ownerId, token, acquiredAt: currentIso(options), expiresAt };
  try {
    await writeOwnerMetadata(lockPath, metadata);
  } catch (error) {
    await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return {
    ownerId,
    token,
    lockPath,
    stillOwned: async () => ownerMatches(lockPath, ownerId, token),
    renew: async (nextExpiresAt?: string) => {
      if (!await ownerMatches(lockPath, ownerId, token)) throw new Error(`audit storage lock is not owned: ${lockPath}`);
      await writeOwnerMetadata(lockPath, { ...metadata, expiresAt: nextExpiresAt ?? expiresAt });
      const now = new Date(currentMs(options));
      await utimes(lockPath, now, now);
    },
    release: async () => {
      if (await ownerMatches(lockPath, ownerId, token)) await rm(lockPath, { recursive: true, force: true });
    },
  };
}

async function writeOwnerMetadata(lockPath: string, metadata: OwnerMetadata): Promise<void> {
  const path = join(lockPath, 'owner.json');
  const tempPath = join(lockPath, `owner.tmp-${process.pid}-${randomUUID()}`);
  try {
    await writeFile(tempPath, `${JSON.stringify(metadata)}\n`, 'utf8');
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function ownerMatches(lockPath: string, ownerId: string, token: string): Promise<boolean> {
  const metadata = await readOwnerMetadata(lockPath);
  return metadata?.ownerId === ownerId && metadata.token === token;
}

async function readOwnerMetadata(lockPath: string): Promise<OwnerMetadata | null> {
  try {
    const parsed = JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8')) as unknown;
    if (!isRecord(parsed) || typeof parsed.ownerId !== 'string' || typeof parsed.token !== 'string' || typeof parsed.acquiredAt !== 'string') return null;
    return {
      ownerId: parsed.ownerId,
      token: parsed.token,
      acquiredAt: parsed.acquiredAt,
      expiresAt: typeof parsed.expiresAt === 'string' ? parsed.expiresAt : undefined,
    };
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    return null;
  }
}

async function isLockStale(lockPath: string, staleMs: number, nowMs: number): Promise<boolean> {
  const metadata = await readOwnerMetadata(lockPath);
  if (metadata?.expiresAt !== undefined) {
    const expiresAt = Date.parse(metadata.expiresAt);
    if (Number.isFinite(expiresAt) && expiresAt > nowMs) return false;
  }
  const lockStat = await stat(lockPath).catch((error: unknown) => {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  });
  return lockStat !== null && nowMs - lockStat.mtimeMs > staleMs;
}

function buildIsolateRecord(input: AuditIsolateInput, isolatedAt: string): AuditIsolateRecord {
  if (input.source === 'send') {
    validateSingleLinePayload(input.payload, 'isolate payload');
    if (!controlledSendIsolateReasons.has(input.reason)) throw new Error('audit isolate reason must be controlled');
    const payloadSha256 = sha256(input.payload);
    return { id: payloadSha256, source: 'send', payload: input.payload, payloadSha256, reason: input.reason, statusCode: input.statusCode, isolatedAt };
  }
  if (!controlledBadLineIsolateReasons.has(input.reason)) throw new Error('audit isolate reason must be controlled');
  if (!/^[a-f0-9]{64}$/.test(input.lineHash)) throw new Error('audit isolate line hash must be sha256 hex');
  if (!Number.isInteger(input.byteLength) || input.byteLength < 0) throw new Error('audit isolate byteLength must be nonnegative');
  return { id: input.lineHash, source: 'bad-line', lineHash: input.lineHash, byteLength: input.byteLength, reason: input.reason, isolatedAt };
}

function parseRetryItem(line: string): RetryItem | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!isRecord(parsed)) return null;
    const item = retryItemFromRecord(parsed);
    return item;
  } catch {
    return null;
  }
}

function retryItemFromRecord(record: Record<string, unknown>): RetryItem | null {
  if (!Object.keys(record).every((key) => retryItemKeys.has(key))) return null;
  if (typeof record.id !== 'string' || !/^[a-f0-9]{64}$/.test(record.id)) return null;
  if (typeof record.payload !== 'string' || record.payload.length === 0 || /[\r\n]/.test(record.payload)) return null;
  if (typeof record.payloadSha256 !== 'string' || record.payloadSha256 !== sha256(record.payload)) return null;
  if (typeof record.reason !== 'string' || !controlledRetryReasons.has(record.reason as AuditRetryReason)) return null;
  if (typeof record.category !== 'string' || !controlledRetryCategories.has(record.category as AuditRetryCategory)) return null;
  if (!Number.isInteger(record.attempts) || (record.attempts as number) < 0) return null;
  if (typeof record.firstAttemptedAt !== 'string' || !isStrictIso(record.firstAttemptedAt)) return null;
  if (record.lastAttemptedAt !== undefined && (typeof record.lastAttemptedAt !== 'string' || !isStrictIso(record.lastAttemptedAt))) return null;
  return {
    id: record.id,
    payload: record.payload,
    payloadSha256: record.payloadSha256,
    reason: record.reason as AuditRetryReason,
    category: record.category as AuditRetryCategory,
    attempts: record.attempts as number,
    firstAttemptedAt: record.firstAttemptedAt,
    lastAttemptedAt: record.lastAttemptedAt,
  };
}

async function readBoundedText(path: string, maxBytes: number): Promise<{ raw: string; truncated: boolean }> {
  let file;
  try {
    file = await open(path, 'r');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { raw: '', truncated: false };
    throw error;
  }
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await file.read(buffer, 0, maxBytes + 1, 0);
    const truncated = bytesRead > maxBytes;
    const rawPrefix = buffer.subarray(0, Math.min(bytesRead, maxBytes)).toString('utf8');
    if (!truncated) return { raw: rawPrefix, truncated: false };
    const lastNewline = rawPrefix.lastIndexOf('\n');
    return { raw: lastNewline >= 0 ? rawPrefix.slice(0, lastNewline + 1) : '', truncated: true };
  } finally {
    await file.close();
  }
}

async function assertLeaseStillOwned(lease: AuditReplayLease | undefined): Promise<void> {
  if (lease !== undefined && !await lease.stillOwned()) throw new Error('audit replay lease is no longer owned');
}

async function readTextIfExists(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return '';
    throw error;
  }
}

function validateSingleLinePayload(payload: string, label: string): void {
  if (payload.length === 0 || payload.trim().length === 0) throw new Error(`audit ${label} must be non-empty`);
  if (/[\r\n]/.test(payload)) throw new Error(`audit ${label} must be single-line`);
}

function boundedMaxItems(value: number): number {
  const maxItems = positiveInteger(value, 'maxItems');
  return Math.min(maxItems, maxReadItemsCap);
}

function boundedMaxBytes(value: number): number {
  const maxBytes = positiveInteger(value, 'maxBytes');
  if (maxBytes > maxReadBytesCap) throw new Error(`audit storage maxBytes must be <= ${maxReadBytesCap}`);
  return maxBytes;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`audit storage ${label} must be a positive integer`);
  return value;
}

function currentDate(options: AuditStorageOptions): Date {
  return options.now?.() ?? new Date();
}

function currentMs(options: AuditStorageOptions): number {
  return options.nowMs?.() ?? Date.now();
}

function currentIso(options: AuditStorageOptions): string {
  return currentDate(options).toISOString();
}

function datePart(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function ownerIdFor(options: AuditStorageOptions): string {
  const ownerId = options.makeOwnerId?.() ?? `${process.pid}-${randomUUID()}`;
  if (ownerId.length === 0 || /[\r\n]/.test(ownerId)) throw new Error('audit storage owner id must be controlled');
  return ownerId;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function isStrictIso(value: string): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
}

function isLockContentionError(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'EEXIST' || code === 'EPERM' || code === 'EACCES' || code === 'ENOENT';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sleepUntilDeadline(ms: number, deadlineMs: number, options: AuditStorageOptions): Promise<void> {
  const remainingMs = deadlineMs - currentMs(options);
  if (remainingMs <= 0) return;
  await sleep(Math.min(ms, remainingMs));
}
