import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAuditEvent, serializeAuditEvent } from '../src/audit/event.js';
import type { SaveConfirmationContextInput } from '../src/audit/confirmationContextStore.js';
import type { AuditContext, AuditEntity, AuditRecordResult, AuditToolSpanHandle, CanonicalAuditEvent, CanonicalAuditEventName, CanonicalAuditStatus } from '../src/audit/types.js';
import { parseAgentToolConfirmRequest } from '../src/agentRuntime/approvalCard.js';
import type { AuditEndInput, AuditErrorInput, AuditRecordInput, AuditSpanWriter, AuditStartInput } from '../src/audit/auditLogger.js';
import { createAgentRuntime } from '../src/agentRuntime/runtime.js';
import { executeAgentToolRequest, type AgentToolExecutionOptions } from '../src/feishuBot/agentToolExecutor.js';
import { executeOrConfirmAgentToolRequest, handleBotIntent } from '../src/feishuBot/tools.js';

const mocks = vi.hoisted(() => ({
  sendFeishuCard: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock('../src/notify/feishu.js', () => ({
  sendFeishuCard: mocks.sendFeishuCard,
}));

interface ToolEvent {
  event: CanonicalAuditEventName;
  traceId: string;
  spanId: string;
  toolName: string;
  status: CanonicalAuditStatus;
  resultSummary: string;
  parentSpanId?: string;
  entity?: AuditEntity;
  tags?: string[];
  error?: unknown;
}

const tempDirs: string[] = [];
const entryTime = '2026-07-21T08:00:00.000Z';
const laterTime = '2026-07-21T08:00:01.000Z';
const forbiddenFragments = [
  'RAW_REPORT_BODY_SECRET',
  'CARD_SECRET_MARKER',
  'MARKDOWN_SECRET_MARKER',
  'C:/private/report.md',
  '/tmp/private/report.md',
  'arguments_secret_marker',
  'ou_direct_actor',
  'oc_direct_chat',
  'om_direct_message',
  '2000000000000000000733',
  'Pocket 3 Secret Name',
  '733',
  '565',
  'confirmationKey',
  'token=secret',
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

class RecordingDailyAuditWriter implements AuditSpanWriter {
  readonly toolEvents: ToolEvent[] = [];
  readonly lifecycleEvents: CanonicalAuditEvent[] = [];
  readonly serialized: string[] = [];
  readonly startInputs: AuditStartInput[] = [];
  private sequence = 0;

  async record(input: AuditRecordInput): Promise<AuditRecordResult> {
    return this.recordAt(input, new Date(laterTime));
  }

  async recordAt(input: AuditRecordInput, occurredAt: Date): Promise<AuditRecordResult> {
    const event = buildAuditEvent({
      ts: occurredAt.toISOString(),
      agentId: 'mt-agent',
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
    this.lifecycleEvents.push(event);
    const payload = serializeAuditEvent(event);
    this.serialized.push(payload);
    return { ok: true, payload };
  }

  async start(input: AuditStartInput): Promise<AuditToolSpanHandle> {
    this.startInputs.push(input);
    this.sequence += 1;
    const spanId = `tool-span-${this.sequence}`;
    const parentSpanId = input.parentSpanId ?? input.context?.parentSpanId;
    this.toolEvents.push({
      event: 'tool.start',
      traceId: input.traceId,
      spanId,
      toolName: input.toolName,
      status: 'OK',
      resultSummary: input.resultSummary ?? 'started',
      ...(parentSpanId !== undefined ? { parentSpanId } : {}),
      ...(input.entity !== undefined ? { entity: input.entity } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
    });
    return {
      traceId: input.traceId,
      spanId,
      ...(parentSpanId !== undefined ? { parentSpanId } : {}),
      toolName: input.toolName,
      ...(input.context !== undefined ? { context: input.context } : {}),
      startedAt: entryTime,
      startedAtMs: 1000 + this.sequence,
    };
  }

  async end(handle: AuditToolSpanHandle, input: AuditEndInput): Promise<AuditRecordResult> {
    this.toolEvents.push({
      event: 'tool.end',
      traceId: handle.traceId,
      spanId: handle.spanId,
      toolName: handle.toolName,
      status: input.status,
      resultSummary: input.resultSummary,
      ...(handle.parentSpanId !== undefined ? { parentSpanId: handle.parentSpanId } : {}),
      ...(input.entity !== undefined ? { entity: input.entity } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
    });
    return { ok: true, payload: '{}' };
  }

  async error(handle: AuditToolSpanHandle, input: AuditErrorInput): Promise<AuditRecordResult> {
    this.toolEvents.push({
      event: 'tool.error',
      traceId: handle.traceId,
      spanId: handle.spanId,
      toolName: handle.toolName,
      status: input.status,
      resultSummary: input.resultSummary,
      ...(handle.parentSpanId !== undefined ? { parentSpanId: handle.parentSpanId } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.error !== undefined ? { error: input.error } : {}),
    });
    return { ok: true, payload: '{}' };
  }
}

afterEach(async () => {
  const dirs = tempDirs.splice(0);
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

beforeEach(() => {
  mocks.sendFeishuCard.mockReset();
  mocks.sendFeishuCard.mockResolvedValue({ sent: true, channel: 'app' });
});

async function tempOutputDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mt-agent-daily-audit-'));
  tempDirs.push(dir);
  return dir;
}

async function writeReport(outputDir: string): Promise<void> {
  const dayDir = join(outputDir, '2026-07-22');
  await mkdir(dayDir, { recursive: true });
  await writeFile(join(dayDir, 'report-context.json'), JSON.stringify(reportContext), 'utf8');
  await writeFile(join(dayDir, '公域数据上下文_2026-07-21.json'), JSON.stringify(reportContext), 'utf8');
  await writeFile(join(dayDir, '公域日报_2026-07-21.md'), 'MARKDOWN_SECRET_MARKER token=secret', 'utf8');
  await writeFile(join(dayDir, 'card.json'), JSON.stringify({ marker: 'CARD_SECRET_MARKER' }), 'utf8');
}

async function writeDataHealth(outputDir: string): Promise<void> {
  const dayDir = join(outputDir, '2026-07-21');
  await mkdir(dayDir, { recursive: true });
  await writeFile(join(dayDir, '公域数据上下文_2026-07-21.json'), JSON.stringify({ dataQualityNotes: ['RAW_REPORT_BODY_SECRET quality note'] }), 'utf8');
  await writeFile(join(dayDir, '订单分析_2026-07-21.json'), JSON.stringify({ pages: { overview: { dataDate: '2026-07-20' } } }), 'utf8');
  await writeFile(join(dayDir, '曝光无ID样本_2026-07-21.json'), JSON.stringify({ samples: [{ secret: 'RAW_REPORT_BODY_SECRET' }] }), 'utf8');
}

function auditContext(): AuditContext {
  return Object.freeze({
    source: 'feishu',
    actorAvailable: true,
    rawActorId: 'ou_direct_actor',
    channel: 'sdk',
    channelType: 'group',
    rawChannelId: 'oc_direct_chat',
    messageId: 'om_direct_message',
    traceId: 'trace-daily-audit',
    requestStartedAt: entryTime,
  });
}

function auditOptions(writer: RecordingDailyAuditWriter, activations: string[] = []): AgentToolExecutionOptions {
  const base = auditContext();
  return {
    auditContext: base,
    auditLogger: writer,
    activateAudit: async (toolName) => {
      activations.push(toolName);
      return Object.freeze({ ...base, parentSpanId: 'agent-span' });
    },
  };
}

function confirmationSubmitValue(response: { card?: unknown }): Record<string, unknown> {
  const card = response.card as { body?: { elements?: Array<{ tag?: string; elements?: Array<{ name?: string; behaviors?: Array<{ value?: unknown }> }> }> } } | undefined;
  const form = card?.body?.elements?.find((element) => element.tag === 'form');
  const button = form?.elements?.find((element) => element.name === 'agent_tool_confirm_submit');
  const value = button?.behaviors?.[0]?.value;
  expect(value).toBeDefined();
  return value as Record<string, unknown>;
}

function assertNoToolSpan(writer: RecordingDailyAuditWriter): void {
  expect(writer.toolEvents).toEqual([]);
  expect(writer.startInputs).toEqual([]);
}

function expectInitialWaitingLifecycle(writer: RecordingDailyAuditWriter): void {
  expect(writer.lifecycleEvents.map((event) => event.event)).toEqual(['run.start', 'agent.start', 'agent.end', 'run.waiting_user']);
  expect(writer.lifecycleEvents.map((event) => event.trace_id)).toEqual(['trace-daily-audit', 'trace-daily-audit', 'trace-daily-audit', 'trace-daily-audit']);
  expect(writer.lifecycleEvents.at(-1)).toMatchObject({ status: 'UNKNOWN', result_summary: 'waiting for user' });
}

function terminalFor(writer: RecordingDailyAuditWriter, toolName: string): ToolEvent {
  const start = writer.toolEvents.find((event) => event.event === 'tool.start' && event.toolName === toolName);
  const terminal = writer.toolEvents.find((event) => (event.event === 'tool.end' || event.event === 'tool.error') && event.toolName === toolName);
  expect(start).toBeDefined();
  expect(terminal).toBeDefined();
  if (!start || !terminal) throw new Error(`missing closed span for ${toolName}`);
  expect(terminal.spanId).toBe(start.spanId);
  expect(terminal.parentSpanId).toBe(start.parentSpanId);
  return terminal;
}

function expectNoPayloadLeak(writer: RecordingDailyAuditWriter): void {
  const payload = JSON.stringify(writer.toolEvents) + '\n' + writer.serialized.join('\n');
  for (const fragment of forbiddenFragments) expect(payload).not.toContain(fragment);
}

describe('Task 7 daily report audit integration', () => {
  it('wraps direct latest_summary without changing its exact BotResponse and maps found report facts', async () => {
    const outputDir = await tempOutputDir();
    await writeReport(outputDir);
    const expected = await handleBotIntent({ type: 'latest_summary' }, outputDir);
    const writer = new RecordingDailyAuditWriter();
    const activations: string[] = [];

    const response = await handleBotIntent({ type: 'latest_summary' }, outputDir, auditOptions(writer, activations));

    expect(response).toEqual(expected);
    expect(activations).toEqual(['publicTraffic.latestSummary']);
    expect(terminalFor(writer, 'publicTraffic.latestSummary')).toMatchObject({ event: 'tool.end', status: 'OK', resultSummary: 'report_context_available', entity: { type: 'report', id: '2026-07-21' } });
    expectNoPayloadLeak(writer);
  });

  it('wraps direct conversion_summary without changing text-only response and maps missing reports as NOT_FOUND', async () => {
    const outputDir = await tempOutputDir();
    const expected = await handleBotIntent({ type: 'conversion_summary', date: '2026-07-21' }, outputDir);
    const writer = new RecordingDailyAuditWriter();

    const response = await handleBotIntent({ type: 'conversion_summary', date: '2026-07-21' }, outputDir, auditOptions(writer));

    expect(response).toEqual(expected);
    expect(response).toEqual({ text: '没有找到 2026-07-21 的公域日报上下文。' });
    expect(terminalFor(writer, 'publicTraffic.conversionSummary')).toMatchObject({ event: 'tool.end', status: 'NOT_FOUND', resultSummary: 'report_context_missing', entity: { type: 'report', id: '2026-07-21' } });
    expectNoPayloadLeak(writer);
  });

  it('keeps runtime run, agent, and direct tool lifecycle closed for direct latest_summary', async () => {
    const outputDir = await tempOutputDir();
    await writeReport(outputDir);
    const writer = new RecordingDailyAuditWriter();
    const runtime = createAgentRuntime({
      outputDir,
      resolveIntent: () => ({ type: 'latest_summary' }),
      auditLogger: writer,
      now: () => new Date(entryTime),
      makeTraceId: () => 'trace-runtime-daily',
      makeSpanId: () => `runtime-span-${writer.lifecycleEvents.length + 1}`,
    });

    const response = await runtime.handle({
      source: 'feishu',
      text: '今日概况',
      actor: { id: 'ou_direct_actor' },
      channel: { id: 'oc_direct_chat', type: 'group' },
      metadata: { messageId: 'om_direct_message', transport: 'sdk' },
    });

    expect(response.text).toContain('公域日报 2026-07-21');
    expect(writer.lifecycleEvents.map((event) => event.event)).toEqual(['run.start', 'agent.start', 'agent.end', 'run.final_result']);
    expect(writer.toolEvents.map((event) => event.event)).toEqual(['tool.start', 'tool.end']);
    expect(writer.toolEvents.every((event) => event.traceId === 'trace-runtime-daily')).toBe(true);
    expectNoPayloadLeak(writer);
  });

  it('maps selected read and query tools from structured safe facts only', async () => {
    const outputDir = await tempOutputDir();
    await writeReport(outputDir);
    await writeDataHealth(outputDir);
    const writer = new RecordingDailyAuditWriter();
    const options = auditOptions(writer);

    await executeAgentToolRequest({ toolName: 'publicTraffic.reportQuery', arguments: { target: 'summary', reason: 'arguments_secret_marker' }, reason: 'safe' }, outputDir, options);
    await executeAgentToolRequest({ toolName: 'productLink.query', arguments: { queryType: 'productDetail', productQuery: '999999' }, reason: 'safe' }, outputDir, options);
    await executeAgentToolRequest({ toolName: 'publicTraffic.problemProducts', arguments: { problemType: 'weak_conversion' }, reason: 'safe' }, outputDir, options);
    await executeAgentToolRequest({ toolName: 'publicTraffic.orderSummary', arguments: {}, reason: 'safe' }, outputDir, options);
    await executeAgentToolRequest({ toolName: 'system.dataHealth', arguments: { date: '2026-07-21' }, reason: 'safe' }, outputDir, options);

    expect(writer.toolEvents.filter((event) => event.event === 'tool.end').map((event) => [event.toolName, event.status, event.resultSummary, event.entity])).toEqual([
      ['publicTraffic.reportQuery', 'OK', 'report_context_available', { type: 'report', id: '2026-07-21' }],
      ['productLink.query', 'NOT_FOUND', 'product_query product_detail matches=0', { type: 'report', id: '2026-07-21' }],
      ['publicTraffic.problemProducts', 'OK', 'report_context_available', { type: 'report', id: '2026-07-21' }],
      ['publicTraffic.orderSummary', 'OK', 'report_context_available', { type: 'report', id: '2026-07-21' }],
      ['system.dataHealth', 'FAILED_PRECONDITION', 'data_health_blocked issues=2 stale_sources=1', { type: 'report', id: '2026-07-21' }],
    ]);
    expectNoPayloadLeak(writer);
  });
});

describe('Task 8 daily report delivery audit integration', () => {
  it('maps resend and push delivery success from structural sender results while preserving exact text', async () => {
    const outputDir = await tempOutputDir();
    await writeReport(outputDir);
    const writer = new RecordingDailyAuditWriter();

    mocks.sendFeishuCard.mockResolvedValue({ sent: true, channel: 'app' });
    const resend = await executeAgentToolRequest({ toolName: 'publicTraffic.resendLatestReport', arguments: { sendTo: 'group' }, reason: 'arguments_secret_marker' }, outputDir, auditOptions(writer));
    const push = await executeAgentToolRequest({ toolName: 'publicTraffic.pushLatestReportToGroup', arguments: {}, reason: 'arguments_secret_marker' }, outputDir, auditOptions(writer));

    expect(resend).toEqual({ text: '最新公域日报已重发。' });
    expect(push).toEqual({ text: '最新公域日报已推送到群。' });
    expect(writer.toolEvents.filter((event) => event.event === 'tool.end').map((event) => [event.toolName, event.status, event.resultSummary, event.entity, event.tags])).toEqual([
      ['publicTraffic.resendLatestReport', 'OK', 'delivery_sent', { type: 'report', id: '2026-07-21' }, ['selected_tool', 'delivery', 'delivery_sent']],
      ['publicTraffic.pushLatestReportToGroup', 'OK', 'delivery_sent', { type: 'report', id: '2026-07-21' }, ['selected_tool', 'delivery', 'delivery_sent']],
    ]);
    expectNoPayloadLeak(writer);
  });

  it('maps explicit sender failure as provider_error without leaking reason or recipient while preserving exact text', async () => {
    const outputDir = await tempOutputDir();
    await writeReport(outputDir);
    const writer = new RecordingDailyAuditWriter();
    const reason = 'secret delivery reason token=secret ou_direct_actor CARD_SECRET_MARKER MARKDOWN_SECRET_MARKER';

    mocks.sendFeishuCard.mockResolvedValue({ sent: false, channel: 'none', reason });
    const resend = await executeAgentToolRequest({ toolName: 'publicTraffic.resendLatestReport', arguments: { date: '2026-07-21', sendTo: 'both' }, reason: 'arguments_secret_marker' }, outputDir, auditOptions(writer));
    const push = await executeAgentToolRequest({ toolName: 'publicTraffic.pushLatestReportToGroup', arguments: { date: '2026-07-21' }, reason: 'arguments_secret_marker' }, outputDir, auditOptions(writer));

    expect(resend).toEqual({ text: `2026-07-21 公域日报重发失败：${reason}` });
    expect(push).toEqual({ text: `2026-07-21 公域日报推送到群失败：${reason}` });
    expect(writer.toolEvents.filter((event) => event.event === 'tool.end').map((event) => [event.toolName, event.status, event.resultSummary, event.tags])).toEqual([
      ['publicTraffic.resendLatestReport', 'UNAVAILABLE', 'delivery_provider_error', ['selected_tool', 'delivery', 'delivery_provider_error']],
      ['publicTraffic.pushLatestReportToGroup', 'UNAVAILABLE', 'delivery_provider_error', ['selected_tool', 'delivery', 'delivery_provider_error']],
    ]);
    expectNoPayloadLeak(writer);
  });

  it('maps malformed and partial sender results as UNKNOWN without parsing failure-looking text', async () => {
    const outputDir = await tempOutputDir();
    await writeReport(outputDir);
    const writer = new RecordingDailyAuditWriter();

    mocks.sendFeishuCard.mockResolvedValueOnce({ channel: 'app', reason: '失败 success text should not classify token=secret' });
    const resend = await executeAgentToolRequest({ toolName: 'publicTraffic.resendLatestReport', arguments: {}, reason: 'arguments_secret_marker' }, outputDir, auditOptions(writer));
    mocks.sendFeishuCard.mockResolvedValueOnce('失败 but malformed');
    const push = await executeAgentToolRequest({ toolName: 'publicTraffic.pushLatestReportToGroup', arguments: {}, reason: 'arguments_secret_marker' }, outputDir, auditOptions(writer));

    expect(resend).toEqual({ text: '最新公域日报重发失败：失败 success text should not classify token=secret' });
    expect(push).toEqual({ text: '最新公域日报推送到群失败：undefined' });
    expect(writer.toolEvents.filter((event) => event.event === 'tool.end').map((event) => [event.toolName, event.status, event.resultSummary, event.tags])).toEqual([
      ['publicTraffic.resendLatestReport', 'UNKNOWN', 'delivery_unknown', ['selected_tool', 'delivery', 'delivery_unknown']],
      ['publicTraffic.pushLatestReportToGroup', 'UNKNOWN', 'delivery_unknown', ['selected_tool', 'delivery', 'delivery_unknown']],
    ]);
    expectNoPayloadLeak(writer);
  });

  it('keeps missing report delivery branches as NOT_FOUND with exact existing text and no sender call', async () => {
    const outputDir = await tempOutputDir();
    const writer = new RecordingDailyAuditWriter();

    const resend = await executeAgentToolRequest({ toolName: 'publicTraffic.resendLatestReport', arguments: {}, reason: 'arguments_secret_marker' }, outputDir, auditOptions(writer));
    const push = await executeAgentToolRequest({ toolName: 'publicTraffic.pushLatestReportToGroup', arguments: { date: '2026-07-21' }, reason: 'arguments_secret_marker' }, outputDir, auditOptions(writer));

    expect(resend).toEqual({ text: '还没有找到可重发的公域日报。' });
    expect(push).toEqual({ text: '没有找到 2026-07-21 的可推送公域日报。' });
    expect(mocks.sendFeishuCard).not.toHaveBeenCalled();
    expect(writer.toolEvents.filter((event) => event.event === 'tool.end').map((event) => [event.toolName, event.status, event.resultSummary])).toEqual([
      ['publicTraffic.resendLatestReport', 'NOT_FOUND', 'report_context_missing'],
      ['publicTraffic.pushLatestReportToGroup', 'NOT_FOUND', 'report_context_missing'],
    ]);
    expectNoPayloadLeak(writer);
  });
});

describe('Task 9 initial confirmation audit sidecar integration', () => {
  it.each([
    {
      intent: { type: 'run_public_traffic_report' } as const,
      toolName: 'publicTraffic.runReport',
      args: {},
      entity: undefined,
    },
    {
      intent: { type: 'refresh_public_traffic_dashboard', date: '2026-07-21', sendTo: 'group' } as const,
      toolName: 'publicTraffic.refreshDashboard',
      args: { date: '2026-07-21', sendTo: 'group' },
      entity: { type: 'report', id: '2026-07-21' } as const,
    },
  ])('persists one safe sidecar for $toolName without changing inline confirmation response', async ({ intent, toolName, args, entity }) => {
    const outputDir = await tempOutputDir();
    const expected = await handleBotIntent(intent, outputDir);
    const expectedSubmit = confirmationSubmitValue(expected);
    const expectedRequest = parseAgentToolConfirmRequest(expectedSubmit);
    const saved: SaveConfirmationContextInput[] = [];
    const writer = new RecordingDailyAuditWriter();

    const response = await handleBotIntent(intent, outputDir, {
      ...auditOptions(writer),
      confirmationContextStore: {
        save: async (input) => {
          saved.push(input);
        },
      },
    });

    expect(response).toEqual(expected);
    expect(parseAgentToolConfirmRequest(confirmationSubmitValue(response))).toEqual(expectedRequest);
    expect(saved).toEqual([
      {
        confirmationKey: expectedSubmit.confirmationKey,
        traceId: 'trace-daily-audit',
        toolName,
        source: 'feishu',
        ...(entity ? { entity } : {}),
        initiatorUserId: expect.stringMatching(/^usr_[a-f0-9]{32}$/),
      },
    ]);
    expect(saved[0]).not.toHaveProperty('requestRef');
    expect(saved[0]?.initiatorUserId).toMatch(/^usr_[a-f0-9]{32}$/);
    expect(JSON.stringify(saved)).not.toContain('ou_direct_actor');
    expect(JSON.stringify(saved)).not.toContain('oc_direct_chat');
    expect(JSON.stringify(saved)).not.toContain('om_direct_message');
    expect(JSON.stringify(saved)).not.toContain(JSON.stringify(args));
    assertNoToolSpan(writer);
  });

  it('keeps runtime initial waiting lifecycle without a tool span while saving the sidecar once', async () => {
    const outputDir = await tempOutputDir();
    const writer = new RecordingDailyAuditWriter();
    const saved: SaveConfirmationContextInput[] = [];
    const runtime = createAgentRuntime({
      outputDir,
      resolveIntent: () => ({ type: 'run_public_traffic_report' }),
      auditLogger: writer,
      now: () => new Date(entryTime),
      makeTraceId: () => 'trace-daily-audit',
      makeSpanId: () => `runtime-span-${writer.lifecycleEvents.length + 1}`,
      handleIntent: (intent, runtimeOutputDir, dependencies) => handleBotIntent(intent, runtimeOutputDir, {
        auditContext: dependencies.auditContext,
        auditLogger: dependencies.auditLogger,
        activateAudit: dependencies.activateAudit,
        confirmationContextStore: {
          save: async (input) => {
            saved.push(input);
          },
        },
      }),
    });

    const response = await runtime.handle({
      source: 'feishu',
      text: '跑公域日报',
      actor: { id: 'ou_direct_actor' },
      channel: { id: 'oc_direct_chat', type: 'group' },
      metadata: { messageId: 'om_direct_message', transport: 'sdk' },
    });

    expect(response.text).toBe('请确认 Agent 操作：publicTraffic.runReport');
    expectInitialWaitingLifecycle(writer);
    assertNoToolSpan(writer);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ traceId: 'trace-daily-audit', toolName: 'publicTraffic.runReport', source: 'feishu' });
    expect(saved[0]).not.toHaveProperty('requestRef');
    expectNoPayloadLeak(writer);
  });

  it('does not alter confirmation response or waiting lifecycle when sidecar save fails', async () => {
    const outputDir = await tempOutputDir();
    const expected = await handleBotIntent({ type: 'refresh_public_traffic_dashboard', date: '2026-07-21' }, outputDir);
    const writer = new RecordingDailyAuditWriter();
    const runtime = createAgentRuntime({
      outputDir,
      resolveIntent: () => ({ type: 'refresh_public_traffic_dashboard', date: '2026-07-21' }),
      auditLogger: writer,
      now: () => new Date(entryTime),
      makeTraceId: () => 'trace-daily-audit',
      makeSpanId: () => `runtime-span-${writer.lifecycleEvents.length + 1}`,
      handleIntent: (intent, runtimeOutputDir, dependencies) => handleBotIntent(intent, runtimeOutputDir, {
        auditContext: dependencies.auditContext,
        auditLogger: dependencies.auditLogger,
        activateAudit: dependencies.activateAudit,
        confirmationContextStore: {
          save: async () => {
            throw new Error('sidecar save failed token=secret');
          },
        },
      }),
    });

    const response = await runtime.handle({
      source: 'feishu',
      text: '补抓访问页 2026-07-21',
      actor: { id: 'ou_direct_actor' },
      channel: { id: 'oc_direct_chat', type: 'group' },
      metadata: { messageId: 'om_direct_message', transport: 'sdk' },
    });

    expect(response).toEqual(expected);
    expectInitialWaitingLifecycle(writer);
    assertNoToolSpan(writer);
    expectNoPayloadLeak(writer);
  });

  it.each([
    {
      toolName: 'publicTraffic.runReport',
      args: {},
      completedArgs: {},
      entity: undefined,
    },
    {
      toolName: 'publicTraffic.refreshDashboard',
      args: { date: '2026-07-21', sendTo: 'group' },
      completedArgs: { date: '2026-07-21', sendTo: 'group' },
      entity: { type: 'report', id: '2026-07-21' } as const,
    },
  ])('persists one safe sidecar for planner-selected $toolName generic confirmation', async ({ toolName, args, completedArgs, entity }) => {
    const outputDir = await tempOutputDir();
    const reason = `planner selected ${toolName} arguments_secret_marker`;
    const expected = await executeOrConfirmAgentToolRequest({ toolName, arguments: args, reason }, outputDir);
    const expectedSubmit = confirmationSubmitValue(expected);
    const writer = new RecordingDailyAuditWriter();
    const saved: SaveConfirmationContextInput[] = [];
    const plannerProvider = {
      proposePlan: vi.fn(async () => JSON.stringify({
        goal: `confirm ${toolName}`,
        selectedTool: toolName,
        arguments: args,
        confidence: 0.99,
        reason,
        requiresConfirmation: true,
      })),
    };
    const runtime = createAgentRuntime({
      outputDir,
      resolveIntent: () => ({ type: 'unknown', text: `planner ${toolName}` }),
      agentPlannerProvider: plannerProvider,
      auditLogger: writer,
      now: () => new Date(entryTime),
      makeTraceId: () => 'trace-daily-audit',
      makeSpanId: () => `runtime-span-${writer.lifecycleEvents.length + 1}`,
      handleIntent: (intent, runtimeOutputDir, dependencies) => handleBotIntent(intent, runtimeOutputDir, {
        auditContext: dependencies.auditContext,
        auditLogger: dependencies.auditLogger,
        activateAudit: dependencies.activateAudit,
        agentPlannerProvider: plannerProvider,
        confirmationContextStore: {
          save: async (input) => {
            saved.push(input);
          },
        },
      }),
    });

    const response = await runtime.handle({
      source: 'feishu',
      text: `planner ${toolName}`,
      actor: { id: 'ou_direct_actor' },
      channel: { id: 'oc_direct_chat', type: 'group' },
      metadata: { messageId: 'om_direct_message', transport: 'sdk' },
    });
    const submitValue = confirmationSubmitValue(response);
    const parsedRequest = parseAgentToolConfirmRequest(submitValue);

    expect(response).toEqual(expected);
    expect(submitValue.confirmationKey).toBe(expectedSubmit.confirmationKey);
    expect(parsedRequest).toEqual({ toolName, arguments: completedArgs, reason });
    expect(saved).toEqual([
      {
        confirmationKey: expectedSubmit.confirmationKey,
        traceId: 'trace-daily-audit',
        toolName,
        source: 'feishu',
        ...(entity ? { entity } : {}),
        initiatorUserId: expect.stringMatching(/^usr_[a-f0-9]{32}$/),
      },
    ]);
    expect(saved[0]).not.toHaveProperty('requestRef');
    expect(JSON.stringify(saved)).not.toContain('arguments_secret_marker');
    expect(JSON.stringify(saved)).not.toContain('sendTo');
    expect(JSON.stringify(saved)).not.toContain('ou_direct_actor');
    expectInitialWaitingLifecycle(writer);
    assertNoToolSpan(writer);
  });

  it('does not save a sidecar for non-selected generic confirmation tools', async () => {
    const outputDir = await tempOutputDir();
    const writer = new RecordingDailyAuditWriter();
    const saved: SaveConfirmationContextInput[] = [];
    const response = await executeOrConfirmAgentToolRequest({ toolName: 'rental.copy', arguments: { productId: '761' }, reason: 'planner selected rental copy' }, outputDir, {
      ...auditOptions(writer),
      confirmationContextStore: {
        save: async (input) => {
          saved.push(input);
        },
      },
    });

    expect(response.text).toBe('请确认 Agent 操作：rental.copy');
    expect(parseAgentToolConfirmRequest(confirmationSubmitValue(response))).toEqual({ toolName: 'rental.copy', arguments: { productId: '761' }, reason: 'planner selected rental copy' });
    expect(saved).toEqual([]);
    assertNoToolSpan(writer);
  });

  it('keeps planner-selected confirmation response unchanged when audit activation fails before sidecar save', async () => {
    const outputDir = await tempOutputDir();
    const request = { toolName: 'publicTraffic.refreshDashboard', arguments: { date: '2026-07-21' }, reason: 'planner selected refresh' };
    const expected = await executeOrConfirmAgentToolRequest(request, outputDir);
    const saved: SaveConfirmationContextInput[] = [];

    const response = await executeOrConfirmAgentToolRequest(request, outputDir, {
      activateAudit: async () => {
        throw new Error('activation failed token=secret');
      },
      confirmationContextStore: {
        save: async (input) => {
          saved.push(input);
        },
      },
    });

    expect(response).toEqual(expected);
    expect(saved).toEqual([]);
  });
});
