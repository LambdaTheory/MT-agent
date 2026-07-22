import { randomUUID } from 'node:crypto';
import { buildAuditEvent, serializeAuditEvent } from './event.js';
import { sendAuditPayload } from './http.js';
import {
  appendRawAuditPayload,
  compactAuditRetryQueue,
  enqueueAuditRetry,
  isolateAuditPayload,
  readAuditRetryBatch,
  withAuditReplayLease,
  type AuditStorageOptions,
} from './storage.js';
import type {
  AuditConfig,
  AuditContext,
  AuditEntity,
  AuditErrorNotice,
  AuditHttpSendResult,
  AuditRecordResult,
  AuditReplayResult,
  AuditToolSpanHandle,
  CanonicalAuditEventName,
  CanonicalAuditStatus,
  FlushResult,
} from './types.js';

export interface AuditLoggerDependencies {
  config: AuditConfig;
  fetchImpl?: typeof fetch;
  storageOptions?: Partial<AuditStorageOptions>;
  now?: () => Date;
  nowMs?: () => number;
  makeSpanId?: () => string;
  onAuditError?: (notice: AuditErrorNotice) => void;
}

export interface AuditRecordInput {
  traceId: string;
  spanId: string;
  event: CanonicalAuditEventName;
  toolName: string;
  status: CanonicalAuditStatus;
  resultSummary: string;
  context?: AuditContext;
  parentSpanId?: string;
  durationMs?: number;
  entity?: AuditEntity;
  error?: unknown;
  tags?: string[];
}

export interface AuditWriter {
  record(input: AuditRecordInput): Promise<AuditRecordResult>;
  recordAt(input: AuditRecordInput, occurredAt: Date): Promise<AuditRecordResult>;
}

export interface AuditSpanWriter extends AuditWriter {
  start(input: AuditStartInput): Promise<AuditToolSpanHandle>;
  end(handle: AuditToolSpanHandle, input: AuditEndInput): Promise<AuditRecordResult>;
  error(handle: AuditToolSpanHandle, input: AuditErrorInput): Promise<AuditRecordResult>;
}

export function isAuditSpanWriter(writer: AuditWriter | undefined): writer is AuditSpanWriter {
  if (writer === undefined) return false;
  const candidate = writer as Partial<Record<keyof AuditSpanWriter, unknown>>;
  return typeof candidate.start === 'function'
    && typeof candidate.end === 'function'
    && typeof candidate.error === 'function';
}

export interface AuditStartInput {
  traceId: string;
  toolName: string;
  context?: AuditContext;
  parentSpanId?: string;
  resultSummary?: string;
  entity?: AuditEntity;
  tags?: string[];
}

export interface AuditEndInput {
  status: CanonicalAuditStatus;
  resultSummary: string;
  entity?: AuditEntity;
  tags?: string[];
}

export interface AuditErrorInput {
  status: CanonicalAuditStatus;
  resultSummary: string;
  error?: unknown;
  tags?: string[];
}

export interface AuditFlushOptions {
  timeoutMs?: number;
}

interface ReplayAccumulator {
  attempted: number;
  accepted: number;
  retry: number;
  isolated: number;
  acceptedIds: Set<string>;
  retriedIds: Set<string>;
}

interface BackgroundOutcome {
  failed: boolean;
  deliveryIsolated: number;
  replay?: AuditReplayResult;
}

interface QueueEvidence {
  pending: number;
  badLines: number;
  truncated: boolean;
  failed: boolean;
}

interface CompletedBackgroundCounters {
  settled: number;
  failed: number;
  deliveryIsolated: number;
  replay: AuditReplayResult;
}

const defaultReplayResult: AuditReplayResult = Object.freeze({ attempted: 0, accepted: 0, retry: 0, isolated: 0, compacted: 0, leased: false, updated: 0, failed: false });

export function createAuditLogger(dependencies: AuditLoggerDependencies): AuditLogger {
  return new AuditLogger(dependencies);
}

export class AuditLogger implements AuditSpanWriter {
  private readonly config: AuditConfig;
  private readonly fetchImpl?: typeof fetch;
  private readonly now: () => Date;
  private readonly nowMs: () => number;
  private readonly makeSpanId: () => string;
  private readonly onAuditError?: (notice: AuditErrorNotice) => void;
  private readonly storage: AuditStorageOptions;
  private readonly background = new Set<Promise<BackgroundOutcome>>();
  private deliveryTail: Promise<void> = Promise.resolve();
  private completedBackground: CompletedBackgroundCounters = {
    settled: 0,
    failed: 0,
    deliveryIsolated: 0,
    replay: defaultReplayResult,
  };
  private replayPromise: Promise<AuditReplayResult> | undefined;
  private flushPromise: Promise<FlushResult> | undefined;
  private noticeFailures = 0;

  constructor(dependencies: AuditLoggerDependencies) {
    this.config = dependencies.config;
    this.fetchImpl = dependencies.fetchImpl;
    this.now = dependencies.now ?? (() => new Date());
    this.nowMs = dependencies.nowMs ?? (() => Date.now());
    this.makeSpanId = dependencies.makeSpanId ?? (() => randomUUID());
    this.onAuditError = dependencies.onAuditError;
    this.storage = {
      ...dependencies.storageOptions,
      logDir: dependencies.config.logDir,
      now: dependencies.storageOptions?.now ?? this.now,
      nowMs: dependencies.storageOptions?.nowMs ?? this.nowMs,
    };
  }

  async record(input: AuditRecordInput): Promise<AuditRecordResult> {
    const capturedDate = this.safeNowForRecord();
    if (capturedDate === undefined) return { ok: false, stage: 'build', category: 'local' };
    return this.recordAt(input, capturedDate);
  }

  async recordAt(input: AuditRecordInput, capturedDate: Date): Promise<AuditRecordResult> {
    let event;
    try {
      event = buildAuditEvent({
        ts: capturedDate.toISOString(),
        agentId: this.config.agentId,
        traceId: input.traceId,
        spanId: input.spanId,
        event: input.event,
        toolName: input.toolName,
        status: input.status,
        resultSummary: input.resultSummary,
        ...(input.context !== undefined ? { context: input.context } : {}),
        ...(input.parentSpanId !== undefined ? { parentSpanId: input.parentSpanId } : {}),
        ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
        ...(input.entity !== undefined ? { entity: input.entity } : {}),
        ...(input.error !== undefined ? { error: input.error } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
      });
    } catch (_error) {
      this.notice({ stage: 'build', category: 'local' });
      return { ok: false, stage: 'build', category: 'local' };
    }

    let payload: string;
    try {
      payload = serializeAuditEvent(event);
    } catch (_error) {
      this.notice({ stage: 'serialize', category: 'local' });
      return { ok: false, stage: 'serialize', category: 'local' };
    }

    try {
      await appendRawAuditPayload({ ...this.storage, now: () => capturedDate, nowMs: () => this.safeNowMs() }, payload);
    } catch (_error) {
      this.notice({ stage: 'append', category: 'local' });
      return { ok: false, stage: 'append', category: 'local' };
    }

    if (this.remoteAvailable()) this.track(this.queueSend(payload));
    return { ok: true, payload };
  }

  async start(input: AuditStartInput): Promise<AuditToolSpanHandle> {
    const startedDate = this.safeNowForStart();
    const startedAt = startedDate.toISOString();
    const startedAtMs = this.safeNowMs();
    const spanId = this.safeSpanId();
    const parentSpanId = input.parentSpanId ?? input.context?.parentSpanId;
    const startRecordResult = await this.recordAt({
      traceId: input.traceId,
      spanId,
      event: 'tool.start',
      toolName: input.toolName,
      status: 'OK',
      resultSummary: input.resultSummary ?? 'started',
      ...(input.context !== undefined ? { context: input.context } : {}),
      ...(parentSpanId !== undefined ? { parentSpanId } : {}),
      ...(input.entity !== undefined ? { entity: input.entity } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
    }, startedDate);
    return {
      traceId: input.traceId,
      spanId,
      ...(parentSpanId !== undefined ? { parentSpanId } : {}),
      toolName: input.toolName,
      ...(input.context !== undefined ? { context: input.context } : {}),
      startedAt,
      startedAtMs,
      startRecordResult,
    };
  }

  async end(handle: AuditToolSpanHandle, input: AuditEndInput): Promise<AuditRecordResult> {
    return this.record({
      traceId: handle.traceId,
      spanId: handle.spanId,
      event: 'tool.end',
      toolName: handle.toolName,
      status: input.status,
      resultSummary: input.resultSummary,
      ...(handle.context !== undefined ? { context: handle.context } : {}),
      ...(handle.parentSpanId !== undefined ? { parentSpanId: handle.parentSpanId } : {}),
      durationMs: this.durationSince(handle.startedAtMs),
      ...(input.entity !== undefined ? { entity: input.entity } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
    });
  }

  async error(handle: AuditToolSpanHandle, input: AuditErrorInput): Promise<AuditRecordResult> {
    return this.record({
      traceId: handle.traceId,
      spanId: handle.spanId,
      event: 'tool.error',
      toolName: handle.toolName,
      status: input.status,
      resultSummary: input.resultSummary,
      ...(handle.context !== undefined ? { context: handle.context } : {}),
      ...(handle.parentSpanId !== undefined ? { parentSpanId: handle.parentSpanId } : {}),
      durationMs: this.durationSince(handle.startedAtMs),
      ...(input.error !== undefined ? { error: input.error } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
    });
  }

  async replay(): Promise<AuditReplayResult> {
    if (!this.remoteAvailable()) return defaultReplayResult;
    if (this.replayPromise !== undefined) return this.replayPromise;
    this.replayPromise = this.replayOnce().catch((_error) => {
      this.notice({ stage: 'replay', category: 'remote' });
      return { ...defaultReplayResult, leased: false, failed: true };
    }).finally(() => {
      this.replayPromise = undefined;
    });
    return this.replayPromise;
  }

  async flush(options: AuditFlushOptions = {}): Promise<FlushResult> {
    const timeoutMs = options.timeoutMs ?? this.config.flushTimeoutMs;
    if (!Number.isFinite(timeoutMs) || !Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      return this.flushResult(false, false, 0, 1, defaultReplayResult, { pending: 0, badLines: 0, truncated: false, failed: false }, 0);
    }
    if (this.flushPromise !== undefined) return this.flushPromise;
    this.flushPromise = this.flushOnce(timeoutMs).catch((_error) => {
      this.notice({ stage: 'flush', category: 'remote' });
      return this.flushResult(false, false, 0, 1, defaultReplayResult, { pending: 0, badLines: 0, truncated: false, failed: true }, 0);
    }).finally(() => {
      this.flushPromise = undefined;
    });
    return this.flushPromise;
  }

  private async sendLater(payload: string): Promise<BackgroundOutcome> {
    if (this.config.retryEnabled) {
      const replay = this.replay().then((result) => ({ failed: result.failed, deliveryIsolated: 0, replay: result }));
      this.track(replay);
      await replay;
    }
    const result = await this.sendPayload(payload);
    await this.dispatchSendResult(payload, result);
    return { failed: false, deliveryIsolated: result.kind === 'isolate' ? 1 : 0 };
  }

  private queueSend(payload: string): Promise<BackgroundOutcome> {
    const delivery = this.deliveryTail.then(() => this.sendLater(payload), () => this.sendLater(payload));
    this.deliveryTail = delivery.then(() => undefined, () => undefined);
    return delivery;
  }

  private async sendPayload(payload: string): Promise<AuditHttpSendResult> {
    const ingestUrl = this.config.ingestUrl;
    if (!this.remoteAvailable() || ingestUrl === undefined) return { kind: 'accepted', statusCode: 204 };
    return sendAuditPayload({
      payload,
      ingestUrl,
      timeoutMs: this.config.ingestTimeoutMs,
      ...(this.fetchImpl !== undefined ? { fetchImpl: this.fetchImpl } : {}),
    });
  }

  private async dispatchSendResult(payload: string, result: AuditHttpSendResult): Promise<void> {
    if (result.kind === 'accepted') return;
    if (result.kind === 'retry') {
      await enqueueAuditRetry(this.storage, { payload, reason: result.reason, category: result.category });
      return;
    }
    await isolateAuditPayload(this.storage, { source: 'send', payload, reason: result.reason, statusCode: result.statusCode });
  }

  private async replayOnce(): Promise<AuditReplayResult> {
    const result = await withAuditReplayLease(this.storage, async (lease) => {
      const batch = await readAuditRetryBatch(this.storage, { maxItems: this.config.retryMaxBatch });
      const accumulator: ReplayAccumulator = { attempted: 0, accepted: 0, retry: 0, isolated: 0, acceptedIds: new Set<string>(), retriedIds: new Set<string>() };
      for (const item of batch.items) {
        if (!await lease.stillOwned()) break;
        accumulator.attempted += 1;
        const sendResult = await this.sendPayload(item.payload);
        if (sendResult.kind === 'accepted') {
          accumulator.accepted += 1;
          accumulator.acceptedIds.add(item.id);
        } else if (sendResult.kind === 'isolate') {
          accumulator.isolated += 1;
          accumulator.acceptedIds.add(item.id);
          await isolateAuditPayload(this.storage, { source: 'send', payload: item.payload, reason: sendResult.reason, statusCode: sendResult.statusCode });
        } else {
          accumulator.retry += 1;
          accumulator.retriedIds.add(item.id);
        }
      }
      let compacted = 0;
      let updated = 0;
      if ((accumulator.acceptedIds.size > 0 || accumulator.retriedIds.size > 0) && await lease.stillOwned()) {
        const compaction = await compactAuditRetryQueue(this.storage, {
          acceptedIds: accumulator.acceptedIds,
          retriedIds: accumulator.retriedIds,
          attemptedAt: this.safeNowForStart().toISOString(),
          lease,
        });
        compacted = compaction.removed;
        updated = compaction.updated;
      }
      return {
        attempted: accumulator.attempted,
        accepted: accumulator.accepted,
        retry: accumulator.retry,
        isolated: accumulator.isolated,
        compacted,
        updated,
        leased: true,
        failed: false,
      };
    });
    return result ?? defaultReplayResult;
  }

  private async flushOnce(timeoutMs: number): Promise<FlushResult> {
    const deadline = Date.now() + Math.max(1, timeoutMs);
    let flushed = 0;
    let failed = 0;
    let deliveryIsolated = 0;
    let replayResult: AuditReplayResult = defaultReplayResult;
    const initialCompleted = this.consumeCompletedBackground();
    flushed += initialCompleted.settled;
    failed += initialCompleted.failed;
    deliveryIsolated += initialCompleted.deliveryIsolated;
    replayResult = mergeReplayResults(replayResult, initialCompleted.replay);
    while (this.background.size > 0) {
      const timedOut = await this.waitForBackground(deadline);
      const completed = this.consumeCompletedBackground();
      flushed += completed.settled;
      failed += completed.failed;
      deliveryIsolated += completed.deliveryIsolated;
      replayResult = mergeReplayResults(replayResult, completed.replay);
      if (timedOut) return this.flushResult(false, true, flushed, failed, replayResult, { pending: 0, badLines: 0, truncated: false, failed: false }, deliveryIsolated);
    }
    if (this.remoteAvailable() && this.config.retryEnabled) {
      const replay = await this.withDeadline(this.replay(), deadline);
      if (replay.timedOut) return this.flushResult(false, true, flushed, failed, replayResult, { pending: 0, badLines: 0, truncated: false, failed: false }, deliveryIsolated);
      if (replay.failed) {
        failed += 1;
      } else {
        replayResult = mergeReplayResults(replayResult, replay.value);
      }
    }
    while (this.background.size > 0) {
      const timedOut = await this.waitForBackground(deadline);
      const completed = this.consumeCompletedBackground();
      flushed += completed.settled;
      failed += completed.failed;
      deliveryIsolated += completed.deliveryIsolated;
      replayResult = mergeReplayResults(replayResult, completed.replay);
      if (timedOut) return this.flushResult(false, true, flushed, failed, replayResult, { pending: 0, badLines: 0, truncated: false, failed: false }, deliveryIsolated);
    }
    const queue = await this.readQueueEvidence();
    if (queue.failed) failed += 1;
    const ok = failed === 0 && replayResult.retry === 0 && replayResult.isolated === 0 && !replayResult.failed && queue.pending === 0 && queue.badLines === 0 && !queue.truncated && !queue.failed && deliveryIsolated === 0;
    return this.flushResult(ok, false, flushed, failed, replayResult, queue, deliveryIsolated);
  }

  private flushResult(ok: boolean, timedOut: boolean, flushed: number, failed: number, replay: AuditReplayResult, queue: QueueEvidence, deliveryIsolated: number): FlushResult {
    return {
      ok,
      flushed,
      failed,
      timedOut,
      backgroundPending: this.background.size,
      replayAttempted: replay.attempted,
      replayAccepted: replay.accepted,
      replayRetried: replay.retry,
      replayIsolated: replay.isolated,
      replayUpdated: replay.updated,
      replayCompacted: replay.compacted,
      replayFailed: replay.failed,
      queuePending: queue.pending,
      queueBadLines: queue.badLines,
      queueTruncated: queue.truncated,
      deliveryIsolated: deliveryIsolated + replay.isolated,
      noticeFailures: this.noticeFailures,
    };
  }

  private async waitForBackground(deadline: number): Promise<boolean> {
    const tasks = [...this.background];
    const result = await this.withDeadline(Promise.all(tasks), deadline);
    return result.timedOut;
  }

  private async withDeadline<T>(promise: Promise<T>, deadline: number): Promise<{ timedOut: false; failed: false; value: T } | { timedOut: false; failed: true } | { timedOut: true }> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { timedOut: true };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<{ timedOut: true }>((resolve) => {
      timer = setTimeout(() => resolve({ timedOut: true }), remaining);
    });
    promise.catch(() => undefined);
    try {
      const result = await Promise.race([
        promise.then((value) => ({ timedOut: false, failed: false, value }) as const).catch(() => ({ timedOut: false, failed: true }) as const),
        timeout,
      ]);
      return result;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private track(task: Promise<void | BackgroundOutcome>): void {
    let tracked: Promise<BackgroundOutcome>;
    tracked = task.then((outcome) => outcome ?? { failed: false, deliveryIsolated: 0 }).catch((_error) => {
      this.notice({ stage: 'send', category: 'remote' });
      return { failed: true, deliveryIsolated: 0 };
    }).then((outcome) => {
      this.recordCompletedBackground(outcome);
      return outcome;
    }).finally(() => {
      this.background.delete(tracked);
    });
    this.background.add(tracked);
  }

  private async readQueueEvidence(): Promise<QueueEvidence> {
    try {
      const result = await readAuditRetryBatch(this.storage, { maxItems: this.config.retryMaxBatch });
      return { pending: result.items.length, badLines: result.badLines, truncated: result.truncated, failed: false };
    } catch (_error) {
      this.notice({ stage: 'flush', category: 'local' });
      return { pending: 0, badLines: 0, truncated: false, failed: true };
    }
  }

  private recordCompletedBackground(outcome: BackgroundOutcome): void {
    this.completedBackground = {
      settled: this.completedBackground.settled + 1,
      failed: this.completedBackground.failed + (outcome.failed ? 1 : 0),
      deliveryIsolated: this.completedBackground.deliveryIsolated + outcome.deliveryIsolated,
      replay: outcome.replay !== undefined ? mergeReplayResults(this.completedBackground.replay, outcome.replay) : this.completedBackground.replay,
    };
  }

  private consumeCompletedBackground(): CompletedBackgroundCounters {
    const consumed = this.completedBackground;
    this.completedBackground = { settled: 0, failed: 0, deliveryIsolated: 0, replay: defaultReplayResult };
    return consumed;
  }

  private durationSince(startedAtMs: number): number {
    const elapsed = this.safeNowMs() - startedAtMs;
    return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0;
  }

  private safeNowForRecord(): Date | undefined {
    try {
      const date = this.now();
      if (Number.isFinite(date.getTime())) return date;
    } catch (_error) {
      this.notice({ stage: 'build', category: 'local' });
      return undefined;
    }
    this.notice({ stage: 'build', category: 'local' });
    return undefined;
  }

  private safeNowForStart(): Date {
    try {
      const date = this.now();
      if (Number.isFinite(date.getTime())) return date;
    } catch (_error) {
      this.notice({ stage: 'build', category: 'local' });
      return new Date();
    }
    this.notice({ stage: 'build', category: 'local' });
    return new Date();
  }

  private safeNowMs(): number {
    try {
      const value = this.nowMs();
      if (Number.isFinite(value) && value >= 0) return value;
    } catch (_error) {
      this.notice({ stage: 'build', category: 'local' });
      return Date.now();
    }
    this.notice({ stage: 'build', category: 'local' });
    return Date.now();
  }

  private safeSpanId(): string {
    try {
      const spanId = this.makeSpanId();
      if (isSafeAuditIdentifier(spanId)) return spanId;
    } catch (_error) {
      this.notice({ stage: 'build', category: 'local' });
      return randomUUID();
    }
    this.notice({ stage: 'build', category: 'local' });
    return randomUUID();
  }

  private remoteAvailable(): boolean {
    return this.config.remoteEnabled && typeof this.config.ingestUrl === 'string' && this.config.ingestUrl.length > 0;
  }

  private notice(notice: AuditErrorNotice): void {
    try {
      this.onAuditError?.(notice);
    } catch (_error) {
      this.noticeFailures += 1;
    }
  }
}

function mergeReplayResults(left: AuditReplayResult, right: AuditReplayResult): AuditReplayResult {
  return {
    attempted: left.attempted + right.attempted,
    accepted: left.accepted + right.accepted,
    retry: left.retry + right.retry,
    isolated: left.isolated + right.isolated,
    compacted: left.compacted + right.compacted,
    leased: left.leased || right.leased,
    updated: left.updated + right.updated,
    failed: left.failed || right.failed,
  };
}

function isSafeAuditIdentifier(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value.trim()) && value.trim() === value && value !== '.' && value !== '..' && !/^(?:ou|oc|om|on)_/.test(value);
}
