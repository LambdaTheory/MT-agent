import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAuditLogger, type AuditLogger } from '../src/audit/auditLogger.js';
import { parseAuditConfig } from '../src/audit/config.js';
import { auditRawPath, readAuditRetryBatch } from '../src/audit/storage.js';
import type { AuditConfig, CanonicalAuditEventName } from '../src/audit/types.js';
import { createAgentRuntime } from '../src/agentRuntime/runtime.js';
import type { AgentRequest } from '../src/agentRuntime/types.js';

type FakeMode = 'accepted' | 'negative_ack';

interface FakeAuditRequest {
  path: string;
  method: string | undefined;
  contentType: string | undefined;
  body: string;
}

const tempDirs: string[] = [];
const fakeServers: FakeAuditService[] = [];
const entryTime = new Date('2026-07-21T08:00:00.000Z');
const laterTime = new Date('2026-07-21T08:00:01.000Z');
const forbiddenFragments = [
  'product_id',
  'platformProductId',
  'displayProductId',
  '2000000000000000000733',
  'platform-565',
  '733',
  '565',
  'confirmationKey',
  'confirmation_key',
  'recipient',
  'sendTo',
  'token=secret',
  'Authorization',
  'Bearer secret-token',
  'arguments_secret_marker',
  'RAW_REPORT_BODY_SECRET',
  'CARD_SECRET_MARKER',
  'MARKDOWN_SECRET_MARKER',
  'C:/private/report.md',
  '/tmp/private/report.md',
  'full stack trace with local path',
  'ou_acceptance_actor',
  'oc_acceptance_chat',
  'om_acceptance_message',
];

const period = {
  exposure: 100,
  publicVisits: 20,
  dashboardVisits: 18,
  createdOrders: 2,
  signedOrders: 2,
  reviewedOrders: 2,
  shippedOrders: 1,
  amount: 88,
  exposureVisitRate: 0.2,
  visitCreatedOrderRate: 0.1,
  visitShipmentRate: 0.05,
  hasExposureData: true,
  hasDashboardData: true,
};

const reportContext = {
  generationId: 'generation-2026-07-21',
  date: '2026-07-21',
  summary: {
    '1d': period,
    '7d': { ...period, exposure: 700, publicVisits: 120, amount: 500 },
    '30d': { ...period, exposure: 3000, publicVisits: 500, amount: 2000 },
  },
  conclusions: [{ label: 'secret', text: 'RAW_REPORT_BODY_SECRET conclusion text' }],
  rows: [
    { productName: 'Pocket 3 Secret Name', platformProductId: '2000000000000000000733', displayProductId: '端内ID 733', custodyDays: 10, periods: { '1d': period, '7d': period, '30d': period } },
    { productName: 'Safe Camera', platformProductId: 'platform-565', displayProductId: '端内ID 565', custodyDays: 3, periods: { '1d': { ...period, hasDashboardData: false }, '7d': period, '30d': period } },
  ],
  lowExposure: [{ identifier: '端内ID 565', action: 'observe', reason: 'MARKDOWN_SECRET_MARKER low exposure' }],
  weakClick: [],
  weakConversion: [{ identifier: '端内ID 733', action: 'improve', reason: 'RAW_REPORT_BODY_SECRET weak conversion' }],
  highPotential: [],
  newProductObservation: [],
  lifecycleGovernance: [{ identifier: '端内ID 565', action: 'review', reason: 'CARD_SECRET_MARKER lifecycle' }],
  recommendedActions: [],
  emptySectionNotes: {},
  dataQualityNotes: ['RAW_REPORT_BODY_SECRET quality note'],
  orderAnalysis: {
    pages: {
      overview: {
        key: 'overview',
        label: '订单概览',
        dataDate: '2026-07-20',
        indicators: [
          { label: '创建订单数', value: '2', delta: '' },
          { label: '签约订单数', value: '2', delta: '' },
          { label: '发货订单数', value: '1', delta: '' },
        ],
      },
    },
  },
};

class FakeAuditService {
  private server: Server | undefined;
  private mode: FakeMode = 'accepted';
  readonly requests: FakeAuditRequest[] = [];

  async start(mode: FakeMode = 'accepted'): Promise<string> {
    this.mode = mode;
    this.server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        this.requests.push({
          path: request.url ?? '',
          method: request.method,
          contentType: request.headers['content-type'],
          body,
        });
        response.statusCode = 202;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(this.mode === 'accepted'
          ? { accepted: 1, rejected: 0, errors: [] }
          : { accepted: 0, rejected: 1, errors: [{ index: 0, code: 'rejected_by_fake' }] }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(0, '127.0.0.1', () => resolve());
    });
    fakeServers.push(this);
    return this.ingestUrl();
  }

  setMode(mode: FakeMode): void {
    this.mode = mode;
  }

  clear(): void {
    this.requests.length = 0;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server === undefined) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }

  private ingestUrl(): string {
    const address = this.server?.address();
    if (typeof address !== 'object' || address === null) throw new Error('fake audit service is not listening');
    return `http://127.0.0.1:${address.port}/v1/ingest`;
  }
}

afterEach(async () => {
  await Promise.all(fakeServers.splice(0).map((server) => server.stop()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('Task 11 local fake audit service acceptance', () => {
  it('keeps local-only direct latest_summary durable as raw NDJSON without changing the business response', async () => {
    const outputDir = await tempOutputDir();
    await writeReport(outputDir);
    const logDir = await tempLogDir();
    const expected = await createRuntime(outputDir).handle(feishuRequest());
    const logger = createLogger(parseConfig(logDir), { runtimeSpanIds: ['run-span-local', 'agent-span-local'], toolSpanIds: ['tool-span-local'] });

    const response = await createRuntime(outputDir, logger, ['run-span-local', 'agent-span-local']).handle(feishuRequest());
    const flush = await logger.flush({ timeoutMs: 500 });
    const rawLines = await readRawLines(logDir);

    expect(response).toEqual(expected);
    expect(flush).toMatchObject({ ok: true, queuePending: 0, replayAttempted: 0 });
    expect(rawLines).toHaveLength(6);
    expect(eventsFrom(rawLines).map((event) => event.event)).toEqual(['run.start', 'agent.start', 'tool.start', 'tool.end', 'agent.end', 'run.final_result']);
    expect(await retryPayloads(logDir)).toEqual([]);
  });

  it('posts accepted direct latest_summary events as exact raw payloads with closed trace, stable pseudonym, and no prohibited data', async () => {
    const outputDir = await tempOutputDir();
    await writeReport(outputDir);
    const logDir = await tempLogDir();
    const fake = new FakeAuditService();
    const ingestUrl = await fake.start('accepted');
    const expected = await createRuntime(outputDir).handle(feishuRequest());
    const logger = createLogger(parseConfig(logDir, ingestUrl), { runtimeSpanIds: ['run-span-1', 'agent-span-1'], toolSpanIds: ['tool-span-1'] });

    const response = await createRuntime(outputDir, logger, ['run-span-1', 'agent-span-1']).handle(feishuRequest());
    const flush = await logger.flush({ timeoutMs: 1_000 });
    const rawLines = await readRawLines(logDir);
    const events = eventsFrom(rawLines);

    expect(response).toEqual(expected);
    expect(flush).toMatchObject({ ok: true, queuePending: 0 });
    expect(fake.requests.map((request) => request.body)).toEqual(rawLines);
    for (const request of fake.requests) assertSingleCanonicalRequest(request);
    expect(events.map((event) => event.event)).toEqual(['run.start', 'agent.start', 'tool.start', 'tool.end', 'agent.end', 'run.final_result']);
    expect(new Set(events.map((event) => event.trace_id))).toEqual(new Set(['trace-acceptance']));
    expect(events.find((event) => event.event === 'agent.start')).toMatchObject({ span_id: 'agent-span-1', parent_span_id: 'run-span-1' });
    expect(events.find((event) => event.event === 'tool.start')).toMatchObject({ span_id: 'tool-span-1', parent_span_id: 'agent-span-1', tool_name: 'publicTraffic.latestSummary' });
    expect(events.find((event) => event.event === 'tool.end')).toMatchObject({ span_id: 'tool-span-1', parent_span_id: 'agent-span-1', entity: { type: 'report', id: '2026-07-21' } });
    expect(events.find((event) => event.event === 'agent.end')).toMatchObject({ span_id: 'agent-span-1', parent_span_id: 'run-span-1' });
    const userIds = events.map((event) => event.user_id);
    expect(new Set(userIds).size).toBe(1);
    expect(userIds[0]).toMatch(/^usr_[a-f0-9]{32}$/);
    assertNoProhibitedPayload(rawLines.join('\n'));
    expect(await retryPayloads(logDir)).toEqual([]);
  });

  it('preserves real latest_summary response when the fake service is unavailable and replays the same six payloads after recovery', async () => {
    const outputDir = await tempOutputDir();
    await writeReport(outputDir);
    const logDir = await tempLogDir();
    const unavailableFake = new FakeAuditService();
    const unavailableUrl = await unavailableFake.start('accepted');
    await unavailableFake.stop();
    const expected = await createRuntime(outputDir).handle(feishuRequest());
    const logger = createLogger(parseConfig(logDir, unavailableUrl), { toolSpanIds: ['tool-span-unavailable-runtime'] });

    const response = await createRuntime(outputDir, logger, ['run-span-unavailable-runtime', 'agent-span-unavailable-runtime']).handle(feishuRequest());
    const flush = await logger.flush({ timeoutMs: 1_000 });
    const rawLines = await readRawLines(logDir);
    const rawEvents = eventsFrom(rawLines);
    const queuedBeforeReplay = await retryPayloads(logDir);

    expect(response).toEqual(expected);
    expect(unavailableFake.requests).toEqual([]);
    expect(flush).toMatchObject({ ok: false, failed: 0, queuePending: 6, deliveryIsolated: 0 });
    expect(flush.replayAttempted).toBeGreaterThanOrEqual(6);
    expect(flush.replayRetried).toBeGreaterThanOrEqual(6);
    expect(rawLines).toHaveLength(6);
    expect(rawEvents.map((event) => event.event)).toEqual(['run.start', 'agent.start', 'tool.start', 'tool.end', 'agent.end', 'run.final_result']);
    expect(new Set(rawEvents.map((event) => event.trace_id))).toEqual(new Set(['trace-acceptance']));
    expect(rawEvents.find((event) => event.event === 'agent.start')).toMatchObject({ span_id: 'agent-span-unavailable-runtime', parent_span_id: 'run-span-unavailable-runtime' });
    expect(rawEvents.find((event) => event.event === 'tool.start')).toMatchObject({ span_id: 'tool-span-unavailable-runtime', parent_span_id: 'agent-span-unavailable-runtime' });
    expect(rawEvents.find((event) => event.event === 'tool.end')).toMatchObject({ span_id: 'tool-span-unavailable-runtime', parent_span_id: 'agent-span-unavailable-runtime' });
    expect(queuedBeforeReplay).toEqual(rawLines);
    const userIds = rawEvents.map((event) => event.user_id);
    expect(new Set(userIds).size).toBe(1);
    expect(userIds[0]).toMatch(/^usr_[a-f0-9]{32}$/);
    assertNoProhibitedPayload(rawLines.join('\n'));

    const recovery = new FakeAuditService();
    const recoveryUrl = await recovery.start('accepted');
    const replayLogger = createLogger(parseConfig(logDir, recoveryUrl, { retryMaxBatch: 2 }), { toolSpanIds: ['unused-recovery-span'] });
    const replayResults = [];
    for (let index = 0; index < 4 && (await retryPayloads(logDir)).length > 0; index += 1) {
      replayResults.push(await replayLogger.replay());
    }

    expect(replayResults.map((result) => result.attempted)).toEqual([2, 2, 2]);
    expect(replayResults.every((result) => result.accepted === result.attempted && result.compacted === result.attempted && result.retry === 0 && !result.failed)).toBe(true);
    expect(recovery.requests.map((request) => request.body)).toEqual(rawLines);
    for (const request of recovery.requests) assertSingleCanonicalRequest(request);
    expect(eventsFrom(recovery.requests.map((request) => request.body))).toEqual(rawEvents);
    expect(await retryPayloads(logDir)).toEqual([]);
    expect(await readRawLines(logDir)).toEqual(rawLines);
  });

  it('queues exact negative-ack and unavailable payload strings, then bounded replay preserves payload identity and compacts only accepted items', async () => {
    const logDir = await tempLogDir();
    const fake = new FakeAuditService();
    const ingestUrl = await fake.start('negative_ack');
    const negativeLogger = createLogger(parseConfig(logDir, ingestUrl, { retryEnabled: false }), { toolSpanIds: ['tool-span-negative'] });
    const negativeResult = await negativeLogger.record({ traceId: 'trace-negative', spanId: 'span-negative', event: 'tool.end', toolName: 'publicTraffic.latestSummary', status: 'OK', resultSummary: 'negative ack event', context: auditContext('trace-negative') });

    await negativeLogger.flush({ timeoutMs: 500 });
    await fake.stop();
    const unavailableLogger = createLogger(parseConfig(logDir, ingestUrl, { retryEnabled: false }), { toolSpanIds: ['tool-span-unavailable'] });
    const unavailableResult = await unavailableLogger.record({ traceId: 'trace-unavailable', spanId: 'span-unavailable', event: 'tool.end', toolName: 'publicTraffic.latestSummary', status: 'OK', resultSummary: 'network unavailable event', context: auditContext('trace-unavailable') });
    const unavailableFlush = await unavailableLogger.flush({ timeoutMs: 500 });
    const rawLines = await readRawLines(logDir);
    const queuedBeforeReplay = await retryPayloads(logDir);

    expect(negativeResult.ok).toBe(true);
    expect(unavailableResult.ok).toBe(true);
    expect(unavailableFlush).toMatchObject({ ok: false, queuePending: 2 });
    expect(queuedBeforeReplay).toEqual(rawLines);
    assertNoProhibitedPayload(rawLines.join('\n'));

    const recovery = new FakeAuditService();
    const recoveryUrl = await recovery.start('accepted');
    const replayLogger = createLogger(parseConfig(logDir, recoveryUrl, { retryMaxBatch: 1 }), { toolSpanIds: ['unused-replay-span'] });
    const firstReplay = await replayLogger.replay();
    const remainingAfterFirst = await retryPayloads(logDir);

    expect(firstReplay).toMatchObject({ attempted: 1, accepted: 1, compacted: 1, retry: 0, failed: false });
    expect(recovery.requests.map((request) => request.body)).toEqual([rawLines[0]]);
    expect(remainingAfterFirst).toEqual([rawLines[1]]);

    const requestCountBeforeConcurrent = recovery.requests.length;
    const [secondReplay, duplicateReplay] = await Promise.all([replayLogger.replay(), replayLogger.replay()]);
    const requestCountAfterConcurrent = recovery.requests.length;
    const finalReplay = await replayLogger.replay();

    expect(secondReplay).toMatchObject({ attempted: 1, accepted: 1, compacted: 1, retry: 0, failed: false });
    expect(duplicateReplay).toMatchObject({ attempted: 1, accepted: 1, compacted: 1, retry: 0, failed: false });
    expect(requestCountAfterConcurrent - requestCountBeforeConcurrent).toBe(1);
    expect(recovery.requests.at(-1)?.body).toBe(rawLines[1]);
    expect(finalReplay).toMatchObject({ attempted: 0, accepted: 0, compacted: 0, retry: 0 });
    expect(recovery.requests).toHaveLength(2);
    expect(await retryPayloads(logDir)).toEqual([]);
    expect(await readRawLines(logDir)).toEqual(rawLines);
    for (const request of recovery.requests) assertSingleCanonicalRequest(request);
    expect(eventsFrom(recovery.requests.map((request) => request.body))).toEqual(eventsFrom(rawLines));
  });
});

async function tempOutputDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mt-agent-audit-fake-output-'));
  tempDirs.push(dir);
  return dir;
}

async function tempLogDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mt-agent-audit-fake-log-'));
  tempDirs.push(dir);
  return join(dir, 'audit');
}

async function writeReport(outputDir: string): Promise<void> {
  const dayDir = join(outputDir, '2026-07-22');
  await mkdir(dayDir, { recursive: true });
  await writeFile(join(dayDir, 'report-context.json'), JSON.stringify(reportContext), 'utf8');
  await writeFile(join(dayDir, '公域数据上下文_2026-07-21.json'), JSON.stringify(reportContext), 'utf8');
  await writeFile(join(dayDir, '公域日报_2026-07-21.md'), 'MARKDOWN_SECRET_MARKER token=secret C:/private/report.md /tmp/private/report.md', 'utf8');
  await writeFile(join(dayDir, 'card.json'), JSON.stringify({ marker: 'CARD_SECRET_MARKER', authorization: 'Bearer secret-token' }), 'utf8');
}

function parseConfig(logDir: string, ingestUrl?: string, overrides: Partial<AuditConfig> = {}): AuditConfig {
  return Object.freeze({
    ...parseAuditConfig({
      MT_AGENT_AUDIT_LOG_DIR: logDir,
      ...(ingestUrl ? { AUDIT_INGEST_URL: ingestUrl } : {}),
      AUDIT_INGEST_TIMEOUT_MS: '150',
      AUDIT_FLUSH_TIMEOUT_MS: '1000',
      AUDIT_RETRY_MAX_BATCH: String(overrides.retryMaxBatch ?? 10),
    }),
    ...overrides,
  });
}

function createLogger(config: AuditConfig, ids: { runtimeSpanIds?: string[]; toolSpanIds?: string[] } = {}): AuditLogger {
  let nowCall = 0;
  let toolSpanCall = 0;
  return createAuditLogger({
    config,
    now: () => nowCall++ === 0 ? entryTime : laterTime,
    nowMs: () => 1_000 + nowCall,
    makeSpanId: () => ids.toolSpanIds?.[toolSpanCall++] ?? `tool-span-${toolSpanCall}`,
    storageOptions: { lockRetryMs: 2, lockAcquireTimeoutMs: 500, replayLeaseMs: 500 },
  });
}

function createRuntime(outputDir: string, logger?: AuditLogger, spanIds: string[] = []): ReturnType<typeof createAgentRuntime> {
  let spanCall = 0;
  return createAgentRuntime({
    outputDir,
    resolveIntent: () => ({ type: 'latest_summary' }),
    ...(logger ? { auditLogger: logger } : {}),
    now: () => entryTime,
    makeTraceId: () => 'trace-acceptance',
    makeSpanId: () => spanIds[spanCall++] ?? `runtime-span-${spanCall}`,
  });
}

function feishuRequest(): AgentRequest {
  return {
    source: 'feishu',
    text: '今日概况 arguments_secret_marker confirmationKey sendTo recipient token=secret',
    actor: { id: 'ou_acceptance_actor' },
    channel: { id: 'oc_acceptance_chat', type: 'group' },
    metadata: { messageId: 'om_acceptance_message', transport: 'sdk', Authorization: 'Bearer secret-token' },
  };
}

function auditContext(traceId: string) {
  return Object.freeze({
    source: 'feishu' as const,
    actorAvailable: true,
    rawActorId: 'ou_acceptance_actor',
    channel: 'sdk' as const,
    channelType: 'group' as const,
    rawChannelId: 'oc_acceptance_chat',
    messageId: 'om_acceptance_message',
    traceId,
    requestStartedAt: entryTime.toISOString(),
  });
}

async function readRawLines(logDir: string): Promise<string[]> {
  const raw = await readFile(auditRawPath(logDir, entryTime), 'utf8');
  return raw.split('\n').filter(Boolean);
}

async function retryPayloads(logDir: string): Promise<string[]> {
  const batch = await readAuditRetryBatch({ logDir }, { maxItems: 10, maxBytes: 1_000_000 });
  return batch.items.map((item) => item.payload);
}

function eventsFrom(lines: string[]): Array<Record<string, unknown> & { event: CanonicalAuditEventName; trace_id: string; span_id: string; user_id?: string }> {
  return lines.map((line) => JSON.parse(line));
}

function assertSingleCanonicalRequest(request: FakeAuditRequest): void {
  expect(request.path).toBe('/v1/ingest');
  expect(request.method).toBe('POST');
  expect(request.contentType).toBe('application/json');
  expect(request.body).not.toContain('\n');
  const event = JSON.parse(request.body) as Record<string, unknown>;
  expect(event).toEqual(expect.objectContaining({
    ts: expect.stringMatching(/^2026-07-21T08:00:0[01]\.000Z$/),
    agent_id: 'mt-agent',
    trace_id: expect.any(String),
    span_id: expect.any(String),
    event: expect.stringMatching(/^(run\.start|agent\.start|tool\.start|tool\.end|agent\.end|run\.final_result)$/),
    tool_name: expect.any(String),
    status: expect.stringMatching(/^(OK|UNKNOWN|NOT_FOUND|INVALID_ARGUMENT|FAILED_PRECONDITION|UNAVAILABLE|INTERNAL)$/),
    result_summary: expect.any(String),
  }));
  expect(Object.keys(event).sort()).toEqual(Object.keys(event).filter((key) => [
    'ts',
    'agent_id',
    'trace_id',
    'span_id',
    'event',
    'tool_name',
    'status',
    'result_summary',
    'parent_span_id',
    'duration_ms',
    'channel',
    'user_id',
    'entity',
    'error',
    'tags',
  ].includes(key)).sort());
}

function assertNoProhibitedPayload(payload: string): void {
  for (const fragment of forbiddenFragments) expect(payload).not.toContain(fragment);
  expect(payload).not.toMatch(/\b(?:ou|oc|om|on)_[A-Za-z0-9._-]+\b/);
}
