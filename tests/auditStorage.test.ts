import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendRawAuditPayload,
  auditIsolatePath,
  auditRawPath,
  auditReplayLeasePath,
  auditRetryQueuePath,
  compactAuditRetryQueue,
  enqueueAuditRetry,
  isolateAuditPayload,
  readAuditRetryBatch,
  withAuditReplayLease,
  type AuditStorageOptions,
} from '../src/audit/storage.js';

const tempDirs: string[] = [];

async function tempLogDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mt-agent-audit-storage-'));
  tempDirs.push(dir);
  return dir;
}

function options(logDir: string, ownerId: string, now = '2026-07-21T08:00:00.000Z'): AuditStorageOptions {
  return {
    logDir,
    now: () => new Date(now),
    makeOwnerId: () => ownerId,
    lockRetryMs: 2,
    lockStaleMs: 5_000,
    lockAcquireTimeoutMs: 5_000,
    replayLeaseMs: 40,
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function retryPayload(index: number): string {
  return JSON.stringify({
    ts: '2026-07-21T08:00:00.000Z',
    agent_id: 'mt-agent',
    trace_id: `trace-${index}`,
    span_id: `span-${index}`,
    event: 'tool.end',
    tool_name: 'publicTraffic.latestSummary',
    status: 'OK',
    result_summary: `payload ${index}`,
  });
}

async function readLines(path: string): Promise<string[]> {
  const raw = await readFile(path, 'utf8');
  return raw.split('\n').filter((line) => line.length > 0);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('audit storage', () => {
  it('exports stable path helpers under the configured audit directory', async () => {
    const logDir = await tempLogDir();

    expect(auditRawPath(logDir, new Date('2026-07-21T23:59:59.000Z'))).toBe(join(logDir, 'audit-2026-07-21.jsonl'));
    expect(auditRetryQueuePath(logDir)).toBe(join(logDir, 'retry-queue.jsonl'));
    expect(auditIsolatePath(logDir, new Date('2026-07-21T00:00:00.000Z'))).toBe(join(logDir, 'isolate-2026-07-21.jsonl'));
    expect(auditReplayLeasePath(logDir)).toBe(join(logDir, 'replay.lease'));
  });

  it('appends raw payloads as exact single NDJSON lines and preserves completion order under contention', async () => {
    const logDir = await tempLogDir();
    const firstCaller = options(logDir, 'raw-owner-a');
    const secondCaller = options(logDir, 'raw-owner-b');
    const payloads = Array.from({ length: 32 }, (_, index) => retryPayload(index));
    const completed: string[] = [];

    await Promise.all(payloads.map((payload, index) =>
      appendRawAuditPayload(index % 2 === 0 ? firstCaller : secondCaller, payload).then(() => {
        completed.push(payload);
      }),
    ));

    const lines = await readLines(auditRawPath(logDir, new Date('2026-07-21T00:00:00.000Z')));
    expect(lines).toEqual(completed);
    expect(new Set(lines)).toEqual(new Set(payloads));
    expect(lines).toHaveLength(payloads.length);
    for (const line of lines) {
      expect(line).not.toContain('\n');
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('rejects blank or multi-line raw payloads without creating partial evidence', async () => {
    const logDir = await tempLogDir();
    const storage = options(logDir, 'raw-owner');

    await expect(appendRawAuditPayload(storage, '')).rejects.toThrow(/payload/i);
    await expect(appendRawAuditPayload(storage, '  ')).rejects.toThrow(/payload/i);
    await expect(appendRawAuditPayload(storage, `${retryPayload(1)}\n${retryPayload(2)}`)).rejects.toThrow(/single-line/i);
    await expect(readFile(auditRawPath(logDir, new Date('2026-07-21T00:00:00.000Z')), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('stores retry envelopes with exact payload bytes, safe local identity, and bounded bad-line-tolerant reads', async () => {
    const logDir = await tempLogDir();
    const storage = options(logDir, 'retry-owner');
    const firstPayload = retryPayload(1);
    const secondPayload = `${retryPayload(2)}   `;

    const first = await enqueueAuditRetry(storage, {
      payload: firstPayload,
      reason: 'network',
      category: 'transient',
      attempts: 0,
    });
    const second = await enqueueAuditRetry(storage, {
      payload: secondPayload,
      reason: 'negative_ack',
      category: 'remote',
      attempts: 2,
    });
    await writeFile(
      auditRetryQueuePath(logDir),
      `not-json\n${JSON.stringify(first)}\n${JSON.stringify({ ...second, attempts: -1 })}\n${JSON.stringify(second)}\n`,
      'utf8',
    );

    const result = await readAuditRetryBatch(storage, { maxItems: 2, maxBytes: 10_000 });

    expect(first.payload).toBe(firstPayload);
    expect(second.payload).toBe(secondPayload);
    expect(first.id).toMatch(/^[a-f0-9]{64}$/);
    expect(first.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.firstAttemptedAt).toBe('2026-07-21T08:00:00.000Z');
    expect(second.lastAttemptedAt).toBe('2026-07-21T08:00:00.000Z');
    expect(result.items.map((item) => item.payload)).toEqual([firstPayload, secondPayload]);
    expect(result.badLines).toBe(2);
    expect(result.truncated).toBe(false);

    const byteLimited = await readAuditRetryBatch(storage, { maxItems: 10, maxBytes: 20 });
    expect(byteLimited.items).toEqual([]);
    expect(byteLimited.truncated).toBe(true);
    expect(JSON.stringify(byteLimited)).not.toContain('not-json');
  });

  it('gives duplicate retry payloads unique queue ids while preserving exact payload hashes', async () => {
    const logDir = await tempLogDir();
    const storage = options(logDir, 'duplicate-owner');
    const payload = retryPayload(701);

    const first = await enqueueAuditRetry(storage, { payload, reason: 'network', category: 'transient', attempts: 0 });
    const second = await enqueueAuditRetry(storage, { payload, reason: 'network', category: 'transient', attempts: 0 });

    expect(first.payload).toBe(payload);
    expect(second.payload).toBe(payload);
    expect(first.payloadSha256).toBe(second.payloadSha256);
    expect(first.id).not.toBe(second.id);

    const result = await compactAuditRetryQueue(storage, { acceptedIds: new Set([first.id]) });
    expect(result).toEqual({ removed: 1, retained: 1, updated: 0, badLines: 0 });
    const remaining = await readAuditRetryBatch(storage, { maxItems: 10, maxBytes: 10_000 });
    expect(remaining.items.map((item) => item.id)).toEqual([second.id]);
    expect(remaining.items[0]?.payload).toBe(payload);
  });

  it('reads only a bounded queue prefix, supports 60 item batches, and rejects extra envelope keys', async () => {
    const logDir = await tempLogDir();
    const storage = options(logDir, 'bounded-owner');
    const items = [];
    for (let index = 0; index < 65; index += 1) {
      items.push(await enqueueAuditRetry(storage, { payload: retryPayload(index), reason: 'network', category: 'transient', attempts: 0 }));
    }
    const extraKeyLine = JSON.stringify({ ...items[0], secret: 'must-not-survive' });
    const prefix = items.slice(0, 60).map((item) => JSON.stringify(item)).join('\n');
    await writeFile(auditRetryQueuePath(logDir), `${prefix}\n${extraKeyLine}\n${'x'.repeat(128_000)}`, 'utf8');

    const result = await readAuditRetryBatch(storage, { maxItems: 60, maxBytes: Buffer.byteLength(`${prefix}\n${extraKeyLine}\n`, 'utf8') + 10 });

    expect(result.items).toHaveLength(60);
    expect(result.items.map((item) => item.payload)).toEqual(items.slice(0, 60).map((item) => item.payload));
    expect(result.badLines).toBe(1);
    expect(result.truncated).toBe(true);
    expect(JSON.stringify(result)).not.toContain('must-not-survive');
  });

  it('rejects maxBytes above the absolute bounded-read cap before allocation', async () => {
    const logDir = await tempLogDir();
    const storage = options(logDir, 'cap-owner');

    await expect(readAuditRetryBatch(storage, { maxItems: 1, maxBytes: Number.MAX_SAFE_INTEGER })).rejects.toThrow(/maxBytes/i);
  });

  it('isolates permanent send failures and malformed-line metadata without copying bad raw text', async () => {
    const logDir = await tempLogDir();
    const storage = options(logDir, 'isolate-owner');
    const payload = retryPayload(1);
    const malformedLine = 'token=secret {not json';

    const sendRecord = await isolateAuditPayload(storage, {
      source: 'send',
      payload,
      reason: 'status_413',
      statusCode: 413,
    });
    const badLineRecord = await isolateAuditPayload(storage, {
      source: 'bad-line',
      lineHash: 'a'.repeat(64),
      byteLength: Buffer.byteLength(malformedLine, 'utf8'),
      reason: 'malformed_json',
    });

    const raw = await readFile(auditIsolatePath(logDir, new Date('2026-07-21T00:00:00.000Z')), 'utf8');
    expect(sendRecord).toMatchObject({ source: 'send', payload, reason: 'status_413', statusCode: 413 });
    expect(badLineRecord).toMatchObject({ source: 'bad-line', lineHash: 'a'.repeat(64), byteLength: malformedLine.length, reason: 'malformed_json' });
    const storedRecords = raw.split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line) as { payload?: string });
    expect(storedRecords[0]?.payload).toBe(payload);
    expect(raw).toContain('malformed_json');
    expect(raw).not.toContain(malformedLine);
    const invalidSendRecord: Record<string, unknown> = { source: 'send', payload, reason: 'full arbitrary error text' };
    await expect(Reflect.apply(isolateAuditPayload, undefined, [storage, invalidSendRecord])).rejects.toThrow(/reason/i);
  });

  it('uses owner-safe directory locks, times out on fresh locks, and recovers manually aged stale locks', async () => {
    const logDir = await tempLogDir();
    const storage = { ...options(logDir, 'lock-owner'), lockStaleMs: 5_000, lockAcquireTimeoutMs: 35 };
    const rawPath = auditRawPath(logDir, new Date('2026-07-21T00:00:00.000Z'));
    const lockPath = `${rawPath}.lock`;
    await mkdir(lockPath, { recursive: true });
    await writeFile(join(lockPath, 'owner.json'), JSON.stringify({ ownerId: 'active-owner', acquiredAt: '2026-07-21T07:59:59.000Z' }), 'utf8');

    await expect(appendRawAuditPayload(storage, retryPayload(1))).rejects.toThrow(/lock/i);
    await expect(stat(lockPath)).resolves.toBeTruthy();

    const oldDate = new Date(Date.now() - 5_000);
    await utimes(lockPath, oldDate, oldDate);
    const recoveryStorage = { ...options(logDir, 'lock-owner'), lockStaleMs: 40, lockAcquireTimeoutMs: 500 };
    await appendRawAuditPayload(recoveryStorage, retryPayload(2));

    await expect(stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readLines(rawPath)).resolves.toEqual([retryPayload(2)]);
  });

  it('serializes stale takeover so a delayed contender cannot delete the new owner', async () => {
    const logDir = await tempLogDir();
    const rawPath = auditRawPath(logDir, new Date('2026-07-21T00:00:00.000Z'));
    const lockPath = `${rawPath}.lock`;
    await mkdir(lockPath, { recursive: true });
    await writeFile(join(lockPath, 'owner.json'), JSON.stringify({ ownerId: 'stale-owner', token: 'old-token', acquiredAt: '2026-07-21T07:00:00.000Z' }), 'utf8');
    const oldDate = new Date(Date.now() - 5_000);
    await utimes(lockPath, oldDate, oldDate);
    const firstCanRemove = deferred();
    const firstObservedStale = deferred();
    const events: string[] = [];
    const first = {
      ...options(logDir, 'stale-contender-a'),
      lockStaleMs: 20,
      lockAcquireTimeoutMs: 300,
      staleTakeoverProbe: async (stage: string) => {
        if (stage === 'before-remove-stale') {
          events.push('a-before-remove');
          firstObservedStale.resolve();
          await firstCanRemove.promise;
        }
      },
    };
    const second = {
      ...options(logDir, 'stale-contender-b'),
      lockStaleMs: 20,
      lockAcquireTimeoutMs: 300,
      staleTakeoverProbe: (stage: string) => {
        if (stage === 'before-remove-stale') events.push('b-before-remove');
      },
    };

    const firstAppend = appendRawAuditPayload(first, retryPayload(301));
    await firstObservedStale.promise;
    const secondAppend = appendRawAuditPayload(second, retryPayload(302));
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(events).toEqual(['a-before-remove']);
    firstCanRemove.resolve();
    await Promise.all([firstAppend, secondAppend]);

    const lines = await readLines(rawPath);
    expect(lines.sort()).toEqual([retryPayload(301), retryPayload(302)].sort());
    await expect(stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(events).toEqual(['a-before-remove']);
  });

  it('fails closed within one bounded timeout when stale lock takeover is already owned', async () => {
    const logDir = await tempLogDir();
    const rawPath = auditRawPath(logDir, new Date('2026-07-21T00:00:00.000Z'));
    const lockPath = `${rawPath}.lock`;
    const takeoverPath = `${lockPath}.takeover`;
    await mkdir(lockPath, { recursive: true });
    await mkdir(takeoverPath, { recursive: true });
    await writeFile(join(lockPath, 'owner.json'), JSON.stringify({ ownerId: 'stale-owner', token: 'old-token', acquiredAt: '2026-07-21T07:00:00.000Z' }), 'utf8');
    await writeFile(join(takeoverPath, 'owner.json'), JSON.stringify({ ownerId: 'active-takeover', token: 'takeover-token', acquiredAt: '2026-07-21T08:00:00.000Z' }), 'utf8');
    const oldDate = new Date(Date.now() - 5_000);
    await utimes(lockPath, oldDate, oldDate);
    const storage = { ...options(logDir, 'blocked-contender'), lockStaleMs: 20, lockRetryMs: 5, lockAcquireTimeoutMs: 60 };
    const startedAt = Date.now();

    await expect(appendRawAuditPayload(storage, retryPayload(401))).rejects.toThrow(/lock/i);

    expect(Date.now() - startedAt).toBeLessThan(250);
    await expect(stat(takeoverPath)).resolves.toBeTruthy();
    await expect(stat(lockPath)).resolves.toBeTruthy();
  });

  it('automatically heartbeats an active replay lease for a callback longer than the lease duration', async () => {
    const logDir = await tempLogDir();
    const owner = { ...options(logDir, 'lease-owner'), replayLeaseMs: 30 };
    const contender = { ...options(logDir, 'lease-contender'), replayLeaseMs: 30 };
    let contenderRan = false;

    const result = await withAuditReplayLease(owner, async (lease) => {
      await new Promise((resolve) => setTimeout(resolve, 70));
      const nested = await withAuditReplayLease(contender, async () => {
        contenderRan = true;
        return 'unexpected';
      });
      return { nested, stillOwned: await lease.stillOwned() };
    });

    expect(result).toEqual({ nested: undefined, stillOwned: true });
    expect(contenderRan).toBe(false);
  });

  it('renews replay lease expiry from nowMs rather than the audit timestamp clock', async () => {
    const logDir = await tempLogDir();
    const baseMs = Date.parse('2026-07-21T08:00:00.000Z');
    let nowMs = baseMs;
    const owner = {
      ...options(logDir, 'clock-owner', '2026-07-21T00:00:00.000Z'),
      nowMs: () => nowMs,
      replayLeaseMs: 30,
    };

    await withAuditReplayLease(owner, async (lease) => {
      nowMs = baseMs + 5_000;
      await lease.renew();
      const metadata = JSON.parse(await readFile(join(auditReplayLeasePath(logDir), 'owner.json'), 'utf8')) as { expiresAt?: string };
      expect(metadata.expiresAt).toBe(new Date(baseMs + 5_030).toISOString());
    });
  });

  it('compacts the retry queue atomically and leaves original bytes unchanged when interrupted before rename', async () => {
    const logDir = await tempLogDir();
    const storage = options(logDir, 'compact-owner');
    const first = await enqueueAuditRetry(storage, { payload: retryPayload(1), reason: 'network', category: 'transient', attempts: 0 });
    const second = await enqueueAuditRetry(storage, { payload: retryPayload(2), reason: 'timeout', category: 'transient', attempts: 1 });
    await writeFile(auditRetryQueuePath(logDir), `bad json\n${JSON.stringify({ ...first, secret: 'drop-me' })}\n${JSON.stringify(second)}\n`, 'utf8');
    const original = await readFile(auditRetryQueuePath(logDir), 'utf8');

    await expect(compactAuditRetryQueue(storage, {
      acceptedIds: new Set([first.id]),
      beforeCommit: () => {
        throw new Error('stop before rename');
      },
    })).rejects.toThrow(/stop before rename/);

    expect(await readFile(auditRetryQueuePath(logDir), 'utf8')).toBe(original);
    expect((await readdir(logDir)).filter((entry) => entry.includes('.tmp-'))).toEqual([]);

    const result = await compactAuditRetryQueue(storage, { acceptedIds: new Set([first.id]) });
    expect(result).toEqual({ removed: 0, retained: 1, updated: 0, badLines: 2 });
    await expect(readLines(auditRetryQueuePath(logDir))).resolves.toEqual([JSON.stringify(second)]);
  });

  it('updates retained retry attempt metadata without changing payload identity or atomic failure guarantees', async () => {
    const logDir = await tempLogDir();
    const storage = options(logDir, 'retry-update-owner');
    const payload = retryPayload(801);
    const item = await enqueueAuditRetry(storage, { payload, reason: 'negative_ack', category: 'remote', attempts: 2 });
    const original = await readFile(auditRetryQueuePath(logDir), 'utf8');
    const attemptedAt = '2026-07-21T09:00:00.000Z';

    await expect(compactAuditRetryQueue(storage, {
      acceptedIds: new Set<string>(),
      retriedIds: new Set([item.id]),
      attemptedAt,
      beforeCommit: () => {
        throw new Error('stop retry update');
      },
    })).rejects.toThrow(/stop retry update/);
    expect(await readFile(auditRetryQueuePath(logDir), 'utf8')).toBe(original);

    const result = await compactAuditRetryQueue(storage, {
      acceptedIds: new Set<string>(),
      retriedIds: new Set([item.id]),
      attemptedAt,
    });
    const remaining = await readAuditRetryBatch(storage, { maxItems: 10, maxBytes: 10_000 });

    expect(result).toEqual({ removed: 0, retained: 1, updated: 1, badLines: 0 });
    expect(remaining.items).toHaveLength(1);
    expect(remaining.items[0]).toMatchObject({
      id: item.id,
      payload,
      payloadSha256: item.payloadSha256,
      firstAttemptedAt: item.firstAttemptedAt,
      attempts: 3,
      lastAttemptedAt: attemptedAt,
    });
  });

  it('honors replay lease single-flight, expiry recovery, and compaction ownership checks', async () => {
    const logDir = await tempLogDir();
    const firstOwner = options(logDir, 'replay-owner-a');
    const secondOwner = options(logDir, 'replay-owner-b', '2026-07-21T08:01:00.000Z');
    const item = await enqueueAuditRetry(firstOwner, { payload: retryPayload(1), reason: 'network', category: 'transient', attempts: 0 });
    const executions: string[] = [];

    const [firstResult, secondResult] = await Promise.all([
      withAuditReplayLease(firstOwner, async (lease) => {
        executions.push('first');
        await compactAuditRetryQueue(firstOwner, { acceptedIds: new Set([item.id]), lease });
        return 'first-result';
      }),
      withAuditReplayLease(secondOwner, async (lease) => {
        executions.push('second');
        await compactAuditRetryQueue(secondOwner, { acceptedIds: new Set([item.id]), lease });
        return 'second-result';
      }),
    ]);

    expect([firstResult, secondResult].filter((value) => value !== undefined)).toHaveLength(1);
    expect(executions).toHaveLength(1);
    await expect(readAuditRetryBatch(firstOwner, { maxItems: 10, maxBytes: 10_000 })).resolves.toMatchObject({ items: [] });

    const leasePath = auditReplayLeasePath(logDir);
    await mkdir(leasePath, { recursive: true });
    await writeFile(join(leasePath, 'owner.json'), JSON.stringify({ ownerId: 'expired-owner', expiresAt: '2026-07-21T07:00:00.000Z' }), 'utf8');
    const oldDate = new Date(Date.now() - 5_000);
    await utimes(leasePath, oldDate, oldDate);

    await expect(withAuditReplayLease(secondOwner, async (lease) => ({ stillOwned: await lease.stillOwned() }))).resolves.toEqual({ stillOwned: true });

    const firstStarted = deferred();
    const secondStarted = deferred();
    const releaseSecond = deferred();
    const activeOwner = { ...options(logDir, 'active-owner-a'), replayLeaseMs: 500 };
    const replacingOwner = { ...options(logDir, 'active-owner-b'), replayLeaseMs: 500 };
    const lostLeaseResult = await withAuditReplayLease(activeOwner, async (lease) => {
      firstStarted.resolve();
      await rm(lease.lockPath, { recursive: true, force: true });
      const secondRun = withAuditReplayLease(replacingOwner, async () => {
        secondStarted.resolve();
        await releaseSecond.promise;
      });
      await secondStarted.promise;
      await expect(compactAuditRetryQueue(activeOwner, { acceptedIds: new Set([item.id]), lease })).rejects.toThrow(/lease/i);
      releaseSecond.resolve();
      await secondRun;
      return 'lost-lease-blocked';
    });
    await firstStarted.promise;
    expect(lostLeaseResult).toBe('lost-lease-blocked');
  });
});
