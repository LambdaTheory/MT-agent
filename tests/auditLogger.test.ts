import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAuditLogger } from '../src/audit/auditLogger.js';
import { buildAuditContext } from '../src/audit/event.js';
import { auditIsolatePath, auditRawPath, auditRetryQueuePath, enqueueAuditRetry, readAuditRetryBatch } from '../src/audit/storage.js';
import type { AuditConfig, AuditRecordResult } from '../src/audit/types.js';

const tempDirs: string[] = [];
const fixedDate = new Date('2026-07-21T08:00:00.000Z');

async function tempLogDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mt-agent-audit-logger-'));
  tempDirs.push(dir);
  return dir;
}

function config(logDir: string, overrides: Partial<AuditConfig> = {}): AuditConfig {
  return Object.freeze({
    agentId: 'mt-agent',
    ingestUrl: 'https://audit.local/v1/ingest',
    remoteEnabled: true,
    localEnabled: true,
    ingestTimeoutMs: 50,
    retryEnabled: true,
    retryMaxBatch: 10,
    logDir,
    flushTimeoutMs: 50,
    ...overrides,
  });
}

function context(traceId = 'trace-1') {
  return buildAuditContext({
    source: 'feishu',
    actorAvailable: true,
    rawActorId: 'ou_actor_1',
    channel: 'sdk',
    traceId,
    requestStartedAt: '2026-07-21T07:59:59.000Z',
    parentSpanId: 'agent-span-1',
  });
}

function acceptedFetch(calls: string[] = []): typeof fetch {
  return async (_input, init) => {
    if (typeof init?.body === 'string') calls.push(init.body);
    return new Response(JSON.stringify({ accepted: 1, rejected: 0, errors: [] }), { status: 202 });
  };
}

function negativeAckFetch(calls: string[] = []): typeof fetch {
  return async (_input, init) => {
    if (typeof init?.body === 'string') calls.push(init.body);
    return new Response(JSON.stringify({ accepted: 0, rejected: 1, errors: [] }), { status: 202 });
  };
}

function deferredResponse(): { fetchImpl: typeof fetch; resolve: () => void; started: Promise<void> } {
  let resolveStarted!: () => void;
  let resolveFetch!: () => void;
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  const fetchDone = new Promise<void>((resolve) => {
    resolveFetch = resolve;
  });
  const fetchImpl: typeof fetch = async () => {
    resolveStarted();
    await fetchDone;
    return new Response(JSON.stringify({ accepted: 1, rejected: 0, errors: [] }), { status: 202 });
  };
  return { fetchImpl, resolve: resolveFetch, started };
}

async function rawLines(logDir: string): Promise<string[]> {
  const raw = await readFile(auditRawPath(logDir, fixedDate), 'utf8');
  return raw.split('\n').filter((line) => line.length > 0);
}

async function settleBackground(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('audit logger', () => {
  it('appends the exact raw payload before starting fetch and record resolves while fetch is unresolved', async () => {
    const logDir = await tempLogDir();
    const gate = deferredResponse();
    const logger = createAuditLogger({ config: config(logDir), fetchImpl: gate.fetchImpl, now: () => fixedDate, nowMs: () => 1_000, makeSpanId: () => 'span-1' });

    const result = await logger.record({ traceId: 'trace-1', spanId: 'span-1', event: 'tool.end', toolName: 'publicTraffic.latestSummary', status: 'OK', resultSummary: 'ready', context: context() });
    await gate.started;
    const lines = await rawLines(logDir);

    expect(result.ok).toBe(true);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ trace_id: 'trace-1', span_id: 'span-1', event: 'tool.end' });
    gate.resolve();
    await expect(logger.flush({ timeoutMs: 200 })).resolves.toMatchObject({ ok: true, timedOut: false });
  });

  it('keeps blank URL configs local-only without fetch or retry queue writes', async () => {
    const logDir = await tempLogDir();
    let fetchCalls = 0;
    const fetchImpl: typeof fetch = async () => {
      fetchCalls += 1;
      return new Response('{}');
    };
    const logger = createAuditLogger({ config: config(logDir, { ingestUrl: undefined, remoteEnabled: false }), fetchImpl, now: () => fixedDate, nowMs: () => 1_000, makeSpanId: () => 'span-1' });

    await expect(logger.record({ traceId: 'trace-1', spanId: 'span-1', event: 'tool.end', toolName: 'publicTraffic.latestSummary', status: 'OK', resultSummary: 'local', context: context() })).resolves.toMatchObject({ ok: true });

    expect(await rawLines(logDir)).toHaveLength(1);
    expect(fetchCalls).toBe(0);
    await expect(readAuditRetryBatch({ logDir }, { maxItems: 10, maxBytes: 10_000 })).resolves.toMatchObject({ items: [] });
  });

  it('dispatches accepted, retry, and isolate outcomes using the exact original payload', async () => {
    const acceptedDir = await tempLogDir();
    const acceptedLogger = createAuditLogger({ config: config(acceptedDir), fetchImpl: acceptedFetch(), now: () => fixedDate, nowMs: () => 1_000, makeSpanId: () => 'span-1' });
    await acceptedLogger.record({ traceId: 'trace-a', spanId: 'span-a', event: 'tool.end', toolName: 'publicTraffic.latestSummary', status: 'OK', resultSummary: 'accepted', context: context('trace-a') });
    await acceptedLogger.flush({ timeoutMs: 200 });
    await expect(readAuditRetryBatch({ logDir: acceptedDir }, { maxItems: 10, maxBytes: 10_000 })).resolves.toMatchObject({ items: [] });

    const retryDir = await tempLogDir();
    const retryFetch: typeof fetch = async () => {
      throw new TypeError('offline');
    };
    const retryLogger = createAuditLogger({ config: config(retryDir, { retryEnabled: false }), fetchImpl: retryFetch, now: () => fixedDate, nowMs: () => 1_000, makeSpanId: () => 'span-1' });
    await retryLogger.record({ traceId: 'trace-r', spanId: 'span-r', event: 'tool.end', toolName: 'publicTraffic.latestSummary', status: 'OK', resultSummary: 'retry', context: context('trace-r') });
    await retryLogger.flush({ timeoutMs: 200 });
    const retryPayload = (await rawLines(retryDir))[0];
    const retryItems = await readAuditRetryBatch({ logDir: retryDir }, { maxItems: 10, maxBytes: 10_000 });
    expect(retryItems.items.map((item) => item.payload)).toEqual([retryPayload]);
    expect(retryItems.items[0]).toMatchObject({ reason: 'network', category: 'transient' });

    const isolateDir = await tempLogDir();
    const isolateFetch: typeof fetch = async () => new Response('', { status: 413 });
    const isolateLogger = createAuditLogger({ config: config(isolateDir), fetchImpl: isolateFetch, now: () => fixedDate, nowMs: () => 1_000, makeSpanId: () => 'span-1' });
    await isolateLogger.record({ traceId: 'trace-i', spanId: 'span-i', event: 'tool.end', toolName: 'publicTraffic.latestSummary', status: 'OK', resultSummary: 'isolate', context: context('trace-i') });
    await isolateLogger.flush({ timeoutMs: 200 });
    const isolatedRaw = await readFile(auditIsolatePath(isolateDir, fixedDate), 'utf8');
    expect(JSON.parse(isolatedRaw.trim())).toMatchObject({ payload: (await rawLines(isolateDir))[0], reason: 'status_413', statusCode: 413 });
  });

  it('queues negative acknowledgements and disables automatic replay when retryEnabled is false', async () => {
    const logDir = await tempLogDir();
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      if (typeof init?.body === 'string') calls.push(init.body);
      return new Response(JSON.stringify({ accepted: 0, rejected: 1, errors: [] }), { status: 202 });
    };
    const logger = createAuditLogger({ config: config(logDir, { retryEnabled: false }), fetchImpl, now: () => fixedDate, nowMs: () => 1_000, makeSpanId: () => 'span-1' });

    await logger.record({ traceId: 'trace-n', spanId: 'span-n', event: 'tool.end', toolName: 'publicTraffic.latestSummary', status: 'OK', resultSummary: 'negative', context: context('trace-n') });
    await logger.flush({ timeoutMs: 200 });

    const rawPayload = (await rawLines(logDir))[0];
    const queued = await readAuditRetryBatch({ logDir }, { maxItems: 10, maxBytes: 10_000 });
    expect(calls).toEqual([rawPayload]);
    expect(queued.items.map((item) => item.payload)).toEqual([rawPayload]);
    expect(queued.items[0]).toMatchObject({ reason: 'negative_ack', category: 'remote' });

    const flushResult = await logger.flush({ timeoutMs: 200 });
    expect(flushResult).toMatchObject({ ok: false, queuePending: 1 });
  });

  it('replays exact queued payloads, compacts only accepted ids, and preserves duplicate payload identities', async () => {
    const logDir = await tempLogDir();
    const payload = '{"stable":true}';
    const first = await enqueueAuditRetry({ logDir, now: () => fixedDate }, { payload, reason: 'network', category: 'transient' });
    const second = await enqueueAuditRetry({ logDir, now: () => fixedDate }, { payload, reason: 'network', category: 'transient' });
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      if (typeof init?.body === 'string') calls.push(init.body);
      return new Response(JSON.stringify(calls.length === 1 ? { accepted: 1, rejected: 0, errors: [] } : { accepted: 0, rejected: 1, errors: [] }), { status: 202 });
    };
    const logger = createAuditLogger({ config: config(logDir), fetchImpl, now: () => fixedDate, nowMs: () => 1_000, makeSpanId: () => 'span-1' });

    const result = await logger.replay();

    expect(result).toMatchObject({ attempted: 2, accepted: 1, retry: 1, isolated: 0, compacted: 1, updated: 1, failed: false });
    expect(calls).toEqual([payload, payload]);
    const remaining = await readAuditRetryBatch({ logDir }, { maxItems: 10, maxBytes: 10_000 });
    expect(remaining.items.map((item) => item.id)).toEqual([second.id]);
    expect(remaining.items[0]?.id).not.toBe(first.id);
    expect(remaining.items[0]).toMatchObject({ payload, attempts: 1 });
  });

  it('waits for older retry replay before starting the current remote delivery', async () => {
    const logDir = await tempLogDir();
    const queuedPayload = '{"queued":"older"}';
    await enqueueAuditRetry({ logDir, now: () => fixedDate }, { payload: queuedPayload, reason: 'network', category: 'transient' });
    const calls: string[] = [];
    let releaseQueued!: () => void;
    let markQueuedStarted!: () => void;
    const queuedGate = new Promise<void>((resolve) => {
      releaseQueued = resolve;
    });
    const queuedStarted = new Promise<void>((resolve) => {
      markQueuedStarted = resolve;
    });
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      calls.push(body);
      if (body === queuedPayload) {
        markQueuedStarted();
        await queuedGate;
      }
      return new Response(JSON.stringify({ accepted: 1, rejected: 0, errors: [] }), { status: 202 });
    };
    const logger = createAuditLogger({ config: config(logDir), fetchImpl, now: () => fixedDate, nowMs: () => Date.now(), makeSpanId: () => 'span-1' });

    const current = await logger.record({ traceId: 'trace-current', spanId: 'span-current', event: 'tool.end', toolName: 'publicTraffic.latestSummary', status: 'OK', resultSummary: 'current', context: context('trace-current') });
    if (!current.ok) throw new Error('expected current audit record to persist locally');
    await queuedStarted;
    await new Promise((resolve) => setTimeout(resolve, 0));
    const callsBeforeReplayRelease = [...calls];
    releaseQueued();
    await logger.flush({ timeoutMs: 200 });

    expect(callsBeforeReplayRelease).toEqual([queuedPayload]);
    expect(calls).toEqual([queuedPayload, current.payload]);
  });

  it('reports replay retryable items as not clean and updates attempt metadata while preserving payload', async () => {
    const logDir = await tempLogDir();
    const payload = '{"retry":true}';
    const item = await enqueueAuditRetry({ logDir, now: () => fixedDate }, { payload, reason: 'negative_ack', category: 'remote', attempts: 0 });
    const logger = createAuditLogger({ config: config(logDir), fetchImpl: negativeAckFetch(), now: () => fixedDate, nowMs: () => 1_000, makeSpanId: () => 'span-1' });

    const replayResult = await logger.replay();
    const flushResult = await logger.flush({ timeoutMs: 200 });
    const remaining = await readAuditRetryBatch({ logDir }, { maxItems: 10, maxBytes: 10_000 });

    expect(replayResult).toMatchObject({ attempted: 1, retry: 1, updated: 1, failed: false });
    expect(flushResult).toMatchObject({ ok: false, replayRetried: 1, queuePending: 1 });
    expect(remaining.items[0]).toMatchObject({ id: item.id, payload, payloadSha256: item.payloadSha256, attempts: 2 });
  });

  it('records separate start/end and start/error spans with stable ids, matching start timestamps, and finite durations', async () => {
    const logDir = await tempLogDir();
    const calls: string[] = [];
    let dateIndex = 0;
    const dates = [new Date('2026-07-21T23:59:59.900Z'), new Date('2026-07-22T00:00:00.100Z')];
    let ms = 10;
    let spanIndex = 0;
    const logger = createAuditLogger({
      config: config(logDir),
      fetchImpl: acceptedFetch(calls),
      now: () => dates[Math.min(dateIndex, dates.length - 1)] ?? fixedDate,
      nowMs: () => ms,
      makeSpanId: () => {
        spanIndex += 1;
        return `tool-span-${spanIndex}`;
      },
    });

    const successHandle = await logger.start({ traceId: 'trace-span-a', toolName: 'publicTraffic.latestSummary', context: context('trace-span-a'), resultSummary: 'starting' });
    ms = 45;
    dateIndex = 1;
    await logger.end(successHandle, { status: 'OK', resultSummary: 'done', entity: { type: 'report', id: '2026-07-20' }, tags: ['daily_report'] });
    ms = 70;
    const errorHandle = await logger.start({ traceId: 'trace-span-b', toolName: 'publicTraffic.latestSummary', context: context('trace-span-b'), resultSummary: 'starting' });
    ms = 100;
    await logger.error(errorHandle, { status: 'INTERNAL', resultSummary: 'failed', error: new Error('safe failure') });
    await logger.flush({ timeoutMs: 200 });

    const firstDayEvents = (await readFile(auditRawPath(logDir, dates[0] ?? fixedDate), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as { ts: string; event: string; trace_id: string; span_id: string; duration_ms?: number });
    const secondDayEvents = (await readFile(auditRawPath(logDir, dates[1] ?? fixedDate), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as { ts: string; event: string; trace_id: string; span_id: string; duration_ms?: number });
    expect(successHandle.startedAt).toBe(firstDayEvents[0]?.ts);
    expect(successHandle).toMatchObject({ traceId: 'trace-span-a', spanId: 'tool-span-1', parentSpanId: 'agent-span-1', toolName: 'publicTraffic.latestSummary', startedAtMs: 10 });
    expect(firstDayEvents.map((event) => event.event)).toEqual(['tool.start']);
    expect(secondDayEvents.map((event) => event.event)).toEqual(['tool.end', 'tool.start', 'tool.error']);
    expect(secondDayEvents.map((event) => event.span_id)).toEqual(['tool-span-1', 'tool-span-2', 'tool-span-2']);
    expect(secondDayEvents[0]?.duration_ms).toBe(35);
    expect(secondDayEvents[2]?.duration_ms).toBe(30);
  });

  it('returns controlled failures for local build, serialize, or append errors and never fetches remotely', async () => {
    const logDir = await tempLogDir();
    const errors: Array<{ stage: string; category: string }> = [];
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response('{}');
    };
    const logger = createAuditLogger({ config: config(logDir), fetchImpl, now: () => fixedDate, nowMs: () => 1_000, makeSpanId: () => 'span-1', onAuditError: (error) => errors.push({ stage: error.stage, category: error.category }) });

    const buildResult: AuditRecordResult = await logger.record({ traceId: 'trace-bad', spanId: 'span-bad', event: 'tool.end', toolName: 'publicTraffic.latestSummary', status: 'OK', resultSummary: ' ', context: context('trace-bad') });
    const serializeResult = await logger.record({ traceId: 'trace-large', spanId: 'span-large', event: 'tool.end', toolName: 'publicTraffic.latestSummary', status: 'OK', resultSummary: 'safe summary', context: context('trace-large'), tags: Array.from({ length: 9000 }, (_value, index) => `tag_${index}`) });
    const invalidLogDir = join(await tempLogDir(), 'audit-file');
    await writeFile(invalidLogDir, 'not a directory', 'utf8');
    const appendLogger = createAuditLogger({ config: config(invalidLogDir), fetchImpl, now: () => fixedDate, nowMs: () => 1_000, makeSpanId: () => 'span-1' });
    const appendResult = await appendLogger.record({ traceId: 'trace-append', spanId: 'span-append', event: 'tool.end', toolName: 'publicTraffic.latestSummary', status: 'OK', resultSummary: 'append', context: context('trace-append') });

    expect(buildResult).toEqual({ ok: false, stage: 'build', category: 'local' });
    expect(serializeResult).toEqual({ ok: false, stage: 'serialize', category: 'local' });
    expect(appendResult).toEqual({ ok: false, stage: 'append', category: 'local' });
    expect(errors).toEqual([{ stage: 'build', category: 'local' }, { stage: 'serialize', category: 'local' }]);
    expect(calls).toBe(0);
  });

  it('contains throwing audit error hooks across record, background send, replay, and flush', async () => {
    const buildDir = await tempLogDir();
    const throwingHook = () => {
      throw new Error('hook failed');
    };
    const buildLogger = createAuditLogger({ config: config(buildDir), fetchImpl: acceptedFetch(), now: () => fixedDate, nowMs: () => 1_000, makeSpanId: () => 'span-1', onAuditError: throwingHook });
    await expect(buildLogger.record({ traceId: 'trace-hook', spanId: 'span-hook', event: 'tool.end', toolName: 'publicTraffic.latestSummary', status: 'OK', resultSummary: ' ', context: context('trace-hook') })).resolves.toEqual({ ok: false, stage: 'build', category: 'local' });

    const backgroundDir = await tempLogDir();
    const queuePath = auditRetryQueuePath(backgroundDir);
    await mkdir(queuePath, { recursive: true });
    const networkFetch: typeof fetch = async () => {
      throw new TypeError('offline');
    };
    const backgroundLogger = createAuditLogger({ config: config(backgroundDir), fetchImpl: networkFetch, now: () => fixedDate, nowMs: () => Date.now(), makeSpanId: () => 'span-1', onAuditError: throwingHook });
    await backgroundLogger.record({ traceId: 'trace-bg', spanId: 'span-bg', event: 'tool.end', toolName: 'publicTraffic.latestSummary', status: 'OK', resultSummary: 'background', context: context('trace-bg') });
    await expect(backgroundLogger.replay()).resolves.toMatchObject({ failed: true });
    await expect(backgroundLogger.flush({ timeoutMs: 200 })).resolves.toMatchObject({ ok: false, failed: expect.any(Number) });
  });

  it('reports forced queue/isolate/compaction storage failures as controlled failed flushes', async () => {
    const enqueueDir = await tempLogDir();
    await mkdir(auditRetryQueuePath(enqueueDir), { recursive: true });
    const networkFetch: typeof fetch = async () => {
      throw new TypeError('offline');
    };
    const enqueueLogger = createAuditLogger({ config: config(enqueueDir), fetchImpl: networkFetch, now: () => fixedDate, nowMs: () => Date.now(), makeSpanId: () => 'span-1' });
    await enqueueLogger.record({ traceId: 'trace-enqueue', spanId: 'span-enqueue', event: 'tool.end', toolName: 'publicTraffic.latestSummary', status: 'OK', resultSummary: 'enqueue', context: context('trace-enqueue') });
    const enqueueFlush = await enqueueLogger.flush({ timeoutMs: 200 });
    expect(enqueueFlush.ok).toBe(false);
    expect(enqueueFlush.failed).toBeGreaterThan(0);

    const isolateDir = await tempLogDir();
    await mkdir(auditIsolatePath(isolateDir, fixedDate), { recursive: true });
    const isolateLogger = createAuditLogger({ config: config(isolateDir), fetchImpl: async () => new Response('', { status: 413 }), now: () => fixedDate, nowMs: () => Date.now(), makeSpanId: () => 'span-1' });
    await isolateLogger.record({ traceId: 'trace-isolate-fail', spanId: 'span-isolate-fail', event: 'tool.end', toolName: 'publicTraffic.latestSummary', status: 'OK', resultSummary: 'isolate', context: context('trace-isolate-fail') });
    await expect(isolateLogger.flush({ timeoutMs: 200 })).resolves.toMatchObject({ ok: false, failed: 1 });

    const replayDir = await tempLogDir();
    await mkdir(auditRetryQueuePath(replayDir), { recursive: true });
    const replayLogger = createAuditLogger({ config: config(replayDir), fetchImpl: acceptedFetch(), now: () => fixedDate, nowMs: () => Date.now(), makeSpanId: () => 'span-1' });
    await expect(replayLogger.replay()).resolves.toMatchObject({ failed: true });
    await expect(replayLogger.flush({ timeoutMs: 200 })).resolves.toMatchObject({ ok: false });
  });

  it('remembers settled background isolate and enqueue failures until flush consumes them', async () => {
    const isolateDir = await tempLogDir();
    const isolateLogger = createAuditLogger({ config: config(isolateDir), fetchImpl: async () => new Response('', { status: 413 }), now: () => fixedDate, nowMs: () => Date.now(), makeSpanId: () => 'span-1' });
    await isolateLogger.record({ traceId: 'trace-settled-isolate', spanId: 'span-settled-isolate', event: 'tool.end', toolName: 'publicTraffic.latestSummary', status: 'OK', resultSummary: 'settled isolate', context: context('trace-settled-isolate') });
    await settleBackground();
    const isolateFlush = await isolateLogger.flush({ timeoutMs: 200 });
    expect(isolateFlush).toMatchObject({ ok: false, backgroundPending: 0, deliveryIsolated: 1, failed: 0 });
    await expect(isolateLogger.flush({ timeoutMs: 200 })).resolves.toMatchObject({ deliveryIsolated: 0 });

    const failureDir = await tempLogDir();
    await mkdir(auditRetryQueuePath(failureDir), { recursive: true });
    const failureLogger = createAuditLogger({ config: config(failureDir), fetchImpl: async () => { throw new TypeError('offline'); }, now: () => fixedDate, nowMs: () => Date.now(), makeSpanId: () => 'span-1' });
    await failureLogger.record({ traceId: 'trace-settled-fail', spanId: 'span-settled-fail', event: 'tool.end', toolName: 'publicTraffic.latestSummary', status: 'OK', resultSummary: 'settled failure', context: context('trace-settled-fail') });
    await settleBackground();
    const failureFlush = await failureLogger.flush({ timeoutMs: 200 });
    expect(failureFlush.ok).toBe(false);
    expect(failureFlush.backgroundPending).toBe(0);
    expect(failureFlush.failed).toBeGreaterThan(0);
  });

  it('preserves completed automatic replay isolate outcomes after queue compaction', async () => {
    const logDir = await tempLogDir();
    const queuedPayload = '{"queued":true}';
    await enqueueAuditRetry({ logDir, now: () => fixedDate }, { payload: queuedPayload, reason: 'network', category: 'transient' });
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      calls.push(body);
      return body === queuedPayload
        ? new Response('', { status: 413 })
        : new Response(JSON.stringify({ accepted: 1, rejected: 0, errors: [] }), { status: 202 });
    };
    const logger = createAuditLogger({ config: config(logDir), fetchImpl, now: () => fixedDate, nowMs: () => Date.now(), makeSpanId: () => 'span-1' });

    await logger.record({ traceId: 'trace-auto-replay', spanId: 'span-auto-replay', event: 'tool.end', toolName: 'publicTraffic.latestSummary', status: 'OK', resultSummary: 'current accepted', context: context('trace-auto-replay') });
    await settleBackground();
    const flushResult = await logger.flush({ timeoutMs: 200 });
    const remaining = await readAuditRetryBatch({ logDir }, { maxItems: 10, maxBytes: 10_000 });

    expect(calls).toContain(queuedPayload);
    expect(remaining.items).toEqual([]);
    expect(flushResult).toMatchObject({ ok: false, backgroundPending: 0, replayAttempted: 1, replayIsolated: 1, queuePending: 0, deliveryIsolated: 1 });
  });

  it('returns controlled failed flush results for invalid timeout overrides without scheduling an infinite timer', async () => {
    const logDir = await tempLogDir();
    const logger = createAuditLogger({ config: config(logDir), fetchImpl: acceptedFetch(), now: () => fixedDate, nowMs: () => Date.now(), makeSpanId: () => 'span-1' });

    for (const timeoutMs of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      await expect(logger.flush({ timeoutMs })).resolves.toMatchObject({ ok: false, failed: 1, timedOut: false });
    }
  });

  it('contains injected clock and span id failures without throwing business-facing logger calls', async () => {
    const recordDir = await tempLogDir();
    const throwingNowLogger = createAuditLogger({
      config: config(recordDir),
      fetchImpl: acceptedFetch(),
      now: () => { throw new Error('clock failed'); },
      nowMs: () => 1_000,
      makeSpanId: () => 'span-1',
      onAuditError: () => { throw new Error('hook failed'); },
    });
    await expect(throwingNowLogger.record({ traceId: 'trace-clock', spanId: 'span-clock', event: 'tool.end', toolName: 'publicTraffic.latestSummary', status: 'OK', resultSummary: 'clock', context: context('trace-clock') })).resolves.toEqual({ ok: false, stage: 'build', category: 'local' });

    const startDir = await tempLogDir();
    const calls: string[] = [];
    const startLogger = createAuditLogger({
      config: config(startDir),
      fetchImpl: acceptedFetch(calls),
      now: () => fixedDate,
      nowMs: () => { throw new Error('monotonic clock failed'); },
      makeSpanId: () => { throw new Error('span failed'); },
      onAuditError: () => { throw new Error('hook failed'); },
    });

    const handle = await startLogger.start({ traceId: 'trace-start-fallback', toolName: 'publicTraffic.latestSummary', context: context('trace-start-fallback') });
    await startLogger.flush({ timeoutMs: 200 });
    const eventRaw = await readFile(auditRawPath(startDir, new Date(handle.startedAt)), 'utf8');
    const event = JSON.parse(eventRaw.split('\n').filter(Boolean)[0] ?? '{}') as { span_id?: string; ts?: string };

    expect(handle.spanId).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(handle.startedAt).toBe(fixedDate.toISOString());
    expect(handle.startedAtMs).toBeGreaterThan(0);
    expect(handle.startRecordResult?.ok).toBe(true);
    expect(event.span_id).toBe(handle.spanId);
    expect(event.ts).toBe(handle.startedAt);

    const rawSpanDir = await tempLogDir();
    const rawSpanLogger = createAuditLogger({
      config: config(rawSpanDir),
      fetchImpl: acceptedFetch(),
      now: () => fixedDate,
      nowMs: () => 2_000,
      makeSpanId: () => 'ou_raw',
      onAuditError: () => { throw new Error('hook failed'); },
    });
    const rawSpanHandle = await rawSpanLogger.start({ traceId: 'trace-raw-span', toolName: 'publicTraffic.latestSummary', context: context('trace-raw-span') });
    await rawSpanLogger.flush({ timeoutMs: 200 });
    const rawSpanEventRaw = await readFile(auditRawPath(rawSpanDir, fixedDate), 'utf8');
    const rawSpanEvent = JSON.parse(rawSpanEventRaw.split('\n').filter(Boolean)[0] ?? '{}') as { span_id?: string };

    expect(rawSpanHandle.spanId).not.toBe('ou_raw');
    expect(rawSpanHandle.spanId).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(rawSpanHandle.spanId).not.toMatch(/^(?:ou|oc|om|on)_/);
    expect(rawSpanHandle.startRecordResult?.ok).toBe(true);
    expect(rawSpanEvent.span_id).toBe(rawSpanHandle.spanId);
  });

  it('bounds hanging flushes, shares concurrent flush work, and drains pending work on success', async () => {
    const timeoutDir = await tempLogDir();
    let timeoutCalls = 0;
    const hangingFetch: typeof fetch = async () => {
      timeoutCalls += 1;
      return new Promise<Response>(() => undefined);
    };
    const timeoutLogger = createAuditLogger({ config: config(timeoutDir, { ingestTimeoutMs: 5, flushTimeoutMs: 10, retryEnabled: false }), fetchImpl: hangingFetch, now: () => fixedDate, nowMs: () => Date.now(), makeSpanId: () => 'span-1' });
    await timeoutLogger.record({ traceId: 'trace-timeout', spanId: 'span-timeout', event: 'tool.end', toolName: 'publicTraffic.latestSummary', status: 'OK', resultSummary: 'hang', context: context('trace-timeout') });
    const [firstTimeout, secondTimeout] = await Promise.all([timeoutLogger.flush({ timeoutMs: 10 }), timeoutLogger.flush({ timeoutMs: 10 })]);
    expect(firstTimeout).toBe(secondTimeout);
    expect(firstTimeout).toMatchObject({ ok: false, timedOut: true });
    expect(timeoutCalls).toBe(1);

    const successDir = await tempLogDir();
    const calls: string[] = [];
    const logger = createAuditLogger({ config: config(successDir), fetchImpl: acceptedFetch(calls), now: () => fixedDate, nowMs: () => Date.now(), makeSpanId: () => 'span-1' });
    await logger.record({ traceId: 'trace-flush', spanId: 'span-flush', event: 'tool.end', toolName: 'publicTraffic.latestSummary', status: 'OK', resultSummary: 'flush', context: context('trace-flush') });
    const flushResult = await logger.flush({ timeoutMs: 200 });
    expect(flushResult).toMatchObject({ ok: true, timedOut: false });
    expect(calls).toHaveLength(1);
  });
});
