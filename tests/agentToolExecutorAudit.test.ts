import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SELECTED_AUDIT_TOOL_NAMES, type SelectedAuditToolName } from '../src/audit/config.js';
import type { AuditContext, AuditRecordResult, AuditToolSpanHandle, CanonicalAuditEventName, CanonicalAuditStatus } from '../src/audit/types.js';
import type { AuditEndInput, AuditErrorInput, AuditRecordInput, AuditSpanWriter, AuditStartInput } from '../src/audit/auditLogger.js';
import type { AgentToolConfirmRequest } from '../src/agentRuntime/approvalCard.js';
import { executeAgentToolRequest, type AgentToolExecutionOptions } from '../src/feishuBot/agentToolExecutor.js';
import { handleBotIntent } from '../src/feishuBot/tools.js';
import type { BotResponse } from '../src/feishuBot/types.js';

const mocks = vi.hoisted(() => ({
  runPublicTrafficReportCli: vi.fn(),
  loadEnv: vi.fn(),
  loadConfig: vi.fn(),
  runDashboardRefresh: vi.fn(),
  sendFeishuCard: vi.fn(),
}));

vi.mock('../src/cli/publicTrafficReport.js', () => ({
  runPublicTrafficReportCli: mocks.runPublicTrafficReportCli,
}));

vi.mock('../src/config/loadEnv.js', () => ({
  loadEnv: mocks.loadEnv,
}));

vi.mock('../src/config/loadConfig.js', () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock('../src/publicTraffic/dashboardRefresh.js', () => ({
  runDashboardRefresh: mocks.runDashboardRefresh,
}));

vi.mock('../src/notify/feishu.js', () => ({
  sendFeishuCard: mocks.sendFeishuCard,
}));

type SpanEvent = {
  event: CanonicalAuditEventName;
  traceId: string;
  spanId: string;
  toolName: string;
  status: CanonicalAuditStatus;
  resultSummary: string;
  parentSpanId?: string;
  entity?: { type: 'report'; id: string };
  error?: unknown;
  tags?: string[];
};

const tempDirs: string[] = [];
const entryTime = '2026-07-21T08:00:00.000Z';
const forbiddenFragments = [
  'RAW_REPORT_BODY_SECRET',
  'C:/private/output/report-context.json',
  '/tmp/private/report-context.json',
  'ou_sensitive_recipient',
  'oc_sensitive_chat',
  'card_secret_marker',
  'token=secret',
  'secret delivery reason',
  'date must be YYYY-MM-DD or a supported short date like 26.6.18',
  'arguments_secret_marker',
];

const metric = Object.freeze({
  exposure: 10,
  publicVisits: 2,
  dashboardVisits: 2,
  createdOrders: 1,
  signedOrders: 1,
  reviewedOrders: 1,
  shippedOrders: 1,
  amount: 88,
  exposureVisitRate: 0.2,
  visitCreatedOrderRate: 0.5,
  visitShipmentRate: 0.5,
  hasExposureData: true,
  hasDashboardData: true,
});

const baseReportContext = Object.freeze({
  date: '2026-07-21',
  summary: {
    '1d': { exposure: 100, publicVisits: 20, dashboardVisits: 18, createdOrders: 2, shippedOrders: 1, amount: 88, exposureVisitRate: 0.2, visitCreatedOrderRate: 0.1, visitShipmentRate: 0.05 },
    '7d': { exposure: 700, publicVisits: 120, dashboardVisits: 110, createdOrders: 12, shippedOrders: 8, amount: 500, exposureVisitRate: 0.17, visitCreatedOrderRate: 0.1, visitShipmentRate: 0.067 },
    '30d': { exposure: 3000, publicVisits: 500, dashboardVisits: 480, createdOrders: 40, shippedOrders: 25, amount: 2000, exposureVisitRate: 0.167, visitCreatedOrderRate: 0.08, visitShipmentRate: 0.05 },
  },
  conclusions: ['stable fixture conclusion'],
  rows: [
    { productName: 'Pocket 3 A', platformProductId: 'platform-733', displayProductId: '端内ID 733', custodyDays: 10, periods: { '1d': metric, '7d': { ...metric, publicVisits: 70 }, '30d': metric } },
    { productName: 'Pocket 3 B', platformProductId: 'platform-761', displayProductId: '端内ID 761', custodyDays: 4, periods: { '1d': { ...metric, hasDashboardData: false }, '7d': { ...metric, publicVisits: 90 }, '30d': metric } },
  ],
  lowExposure: [],
  weakClick: [],
  weakConversion: [{ productId: '733', productName: 'Pocket 3 A', action: 'observe', reason: 'safe fixture' }],
  highPotential: [],
  newProductObservation: [],
  lifecycleGovernance: [{ productId: '761', productName: 'Pocket 3 B', maintenanceStatus: 'removed' }],
  recommendedActions: [],
  emptySectionNotes: {},
  orderAnalysis: { pages: { overview: { indicators: [{ name: '创建订单数', value: '2' }, { name: '签约订单数', value: '1' }, { name: '发货订单数', value: '1' }, { name: '签约发货率', value: '100%' }] } } },
  dataQualityNotes: [],
});

class RecordingAuditSpanWriter implements AuditSpanWriter {
  readonly events: SpanEvent[] = [];
  readonly startInputs: AuditStartInput[] = [];
  readonly endInputs: AuditEndInput[] = [];
  readonly errorInputs: AuditErrorInput[] = [];
  private sequence = 0;

  constructor(private readonly onStart?: (input: AuditStartInput) => Promise<void> | void) {}

  async record(_input: AuditRecordInput): Promise<AuditRecordResult> {
    return { ok: true, payload: '{}' };
  }

  async recordAt(_input: AuditRecordInput, _occurredAt: Date): Promise<AuditRecordResult> {
    return { ok: true, payload: '{}' };
  }

  async start(input: AuditStartInput): Promise<AuditToolSpanHandle> {
    await this.onStart?.(input);
    this.startInputs.push(input);
    this.sequence += 1;
    const spanId = `tool-span-${this.sequence}`;
    const parentSpanId = input.parentSpanId ?? input.context?.parentSpanId;
    this.events.push({
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
    this.endInputs.push(input);
    this.events.push({
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
    this.errorInputs.push(input);
    this.events.push({
      event: 'tool.error',
      traceId: handle.traceId,
      spanId: handle.spanId,
      toolName: handle.toolName,
      status: input.status,
      resultSummary: input.resultSummary,
      ...(handle.parentSpanId !== undefined ? { parentSpanId: handle.parentSpanId } : {}),
      ...(input.error !== undefined ? { error: input.error } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
    });
    return { ok: true, payload: '{}' };
  }
}

class StartFailingAuditSpanWriter extends RecordingAuditSpanWriter {
  override async start(input: AuditStartInput): Promise<AuditToolSpanHandle> {
    await super.start(input);
    throw new Error('audit start failed');
  }
}

class EndFailingAuditSpanWriter extends RecordingAuditSpanWriter {
  override async end(handle: AuditToolSpanHandle, input: AuditEndInput): Promise<AuditRecordResult> {
    await super.end(handle, input);
    throw new Error('audit end failed');
  }
}

class ErrorFailingAuditSpanWriter extends RecordingAuditSpanWriter {
  override async error(handle: AuditToolSpanHandle, input: AuditErrorInput): Promise<AuditRecordResult> {
    await super.error(handle, input);
    throw new Error('audit error failed');
  }
}

function successfulRunReportResult(overrides: Record<string, unknown> = {}) {
  return {
    logPath: 'output/safe-report.log',
    markdownPath: 'output/safe-report.md',
    workbookPath: 'output/safe-report.xlsx',
    reportContextPath: 'output/safe-report-context.json',
    dashboardCrawlSummary: '访问页抓取情况：安全夹具',
    firstReportSent: true,
    reportDate: '2026-07-21',
    ...overrides,
  };
}

afterEach(async () => {
  vi.useRealTimers();
  const dirs = tempDirs.splice(0);
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

beforeEach(() => {
  mocks.runPublicTrafficReportCli.mockReset();
  mocks.runPublicTrafficReportCli.mockResolvedValue(successfulRunReportResult());
  mocks.loadEnv.mockReset();
  mocks.loadEnv.mockResolvedValue(undefined);
  mocks.loadConfig.mockReset();
  mocks.loadConfig.mockResolvedValue({ targetUrl: 'https://example.test/dashboard', periods: ['1d', '7d', '30d'], preferredPageSize: 100, outputDir: 'output', browserProfileDir: 'profile' });
  mocks.runDashboardRefresh.mockReset();
  mocks.runDashboardRefresh.mockResolvedValue(refreshResult('repaired'));
  mocks.sendFeishuCard.mockReset();
  mocks.sendFeishuCard.mockResolvedValue({ sent: true, channel: 'app' });
});

function auditContext(): AuditContext {
  return Object.freeze({
    source: 'feishu',
    actorAvailable: true,
    rawActorId: 'ou_sensitive_recipient',
    channel: 'sdk',
    channelType: 'group',
    rawChannelId: 'oc_sensitive_chat',
    messageId: 'om_sensitive_message',
    traceId: 'trace-agent-tool-executor',
    requestStartedAt: entryTime,
  });
}

function auditOptions(writer: AuditSpanWriter, activations: string[] = []): AgentToolExecutionOptions {
  const base = auditContext();
  return {
    auditContext: base,
    auditLogger: writer,
    activateAudit: async (toolName) => {
      activations.push(toolName);
      if (!SELECTED_AUDIT_TOOL_NAMES.includes(toolName as SelectedAuditToolName)) return undefined;
      return Object.freeze({ ...base, parentSpanId: 'agent-span' });
    },
  };
}

async function tempOutputDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mt-agent-task6-audit-'));
  tempDirs.push(dir);
  return dir;
}

async function writeReport(outputDir: string, runDate = '2026-07-22', context = baseReportContext): Promise<void> {
  const dayDir = join(outputDir, runDate);
  await mkdir(dayDir, { recursive: true });
  await writeFile(join(dayDir, 'report-context.json'), JSON.stringify(context), 'utf8');
  await writeFile(join(dayDir, `公域数据上下文_${context.date}.json`), JSON.stringify(context), 'utf8');
}

async function writeDataHealthFiles(outputDir: string, options: { blocked?: boolean } = {}): Promise<void> {
  const dayDir = join(outputDir, '2026-07-21');
  await mkdir(dayDir, { recursive: true });
  const context = options.blocked ? { dataQualityNotes: ['missing dashboard'] } : { dataQualityNotes: [] };
  await writeFile(join(dayDir, '公域数据上下文_2026-07-21.json'), JSON.stringify(context), 'utf8');
  await writeFile(join(dayDir, '订单分析_2026-07-21.json'), JSON.stringify({ pages: { overview: { dataDate: options.blocked ? '2026-07-20' : '2026-07-21' } } }), 'utf8');
  if (options.blocked) await writeFile(join(dayDir, '曝光无ID样本_2026-07-21.json'), JSON.stringify({ samples: [{ id: 1 }] }), 'utf8');
}

function request(toolName: string, args: Record<string, unknown> = {}): AgentToolConfirmRequest {
  return { toolName, arguments: args, reason: 'safe deterministic audit test arguments_secret_marker' };
}

function refreshResult(status: 'repaired' | 'still_missing' | 'saved_historical_without_report') {
  const complete = status !== 'still_missing';
  return {
    status,
    dataDate: '2026-07-21',
    actualPageDate: '2026-07-21',
    refreshQuality: { hasMissing: !complete, notes: [], periods: { '1d': { complete, rowCount: complete ? 1 : 0 }, '7d': { complete, rowCount: complete ? 1 : 0 }, '30d': { complete, rowCount: complete ? 1 : 0 } } },
    refreshQualityText: complete ? '访问页抓取情况\n1日：完整' : '访问页抓取情况\n1日：缺失',
    firstQualityText: '访问页抓取情况\n1日：缺失',
    rebuild: status === 'repaired' ? 'performed' : 'skipped',
    resend: status === 'repaired' ? 'performed' : 'skipped',
    rawLocation: 'output/safe-raw-location',
    message: status === 'repaired' ? '已重建日报并重发飞书' : '安全保存访问页 raw',
  };
}

function closedSpan(writer: RecordingAuditSpanWriter, toolName: string): { start: SpanEvent; terminal: SpanEvent } {
  const start = writer.events.find((event) => event.event === 'tool.start' && event.toolName === toolName);
  const terminal = writer.events.find((event) => (event.event === 'tool.end' || event.event === 'tool.error') && event.toolName === toolName);
  expect(start).toBeDefined();
  expect(terminal).toBeDefined();
  if (!start || !terminal) throw new Error(`missing closed span for ${toolName}`);
  expect(terminal.spanId).toBe(start.spanId);
  expect(terminal.parentSpanId).toBe(start.parentSpanId);
  return { start, terminal };
}

function expectNoAuditLeak(writer: RecordingAuditSpanWriter): void {
  const serialized = JSON.stringify(writer.events);
  for (const fragment of forbiddenFragments) expect(serialized).not.toContain(fragment);
}

async function expectClosedSpanFor(toolName: SelectedAuditToolName, args: Record<string, unknown> = {}, setup?: (outputDir: string) => Promise<void>): Promise<BotResponse> {
  const outputDir = await tempOutputDir();
  await setup?.(outputDir);
  const writer = new RecordingAuditSpanWriter();
  const response = await executeAgentToolRequest(request(toolName, args), outputDir, auditOptions(writer));
  closedSpan(writer, toolName);
  expectNoAuditLeak(writer);
  return response;
}

describe('Task 6 selected executor audit spans', () => {
  it('starts a selected success span before implementation work and ends it with the same span and parent', async () => {
    const outputDir = await tempOutputDir();
    await writeReport(outputDir);
    const writer = new RecordingAuditSpanWriter(async (input) => {
      expect(input.toolName).toBe('publicTraffic.latestSummary');
    });

    const response = await executeAgentToolRequest(request('publicTraffic.latestSummary'), outputDir, auditOptions(writer));

    expect(response.text).toContain('公域日报 2026-07-21');
    const span = closedSpan(writer, 'publicTraffic.latestSummary');
    expect(span.start).toMatchObject({ traceId: 'trace-agent-tool-executor', parentSpanId: 'agent-span', status: 'OK' });
    expect(span.terminal).toMatchObject({ event: 'tool.end', spanId: span.start.spanId, parentSpanId: 'agent-span', status: 'OK', entity: { type: 'report', id: '2026-07-21' } });
    expect(writer.events.map((event) => event.event)).toEqual(['tool.start', 'tool.end']);
    expectNoAuditLeak(writer);
  });

  it('records INVALID_ARGUMENT tool.error and rethrows the original invalid date error', async () => {
    const outputDir = await tempOutputDir();
    const writer = new RecordingAuditSpanWriter();
    const errorPromise = executeAgentToolRequest(request('publicTraffic.latestSummary', { date: 'not-a-date token=secret' }), outputDir, auditOptions(writer));

    await expect(errorPromise).rejects.toThrow('date must be YYYY-MM-DD or a supported short date like 26.6.18');
    const span = closedSpan(writer, 'publicTraffic.latestSummary');
    expect(span.terminal).toMatchObject({ event: 'tool.error', status: 'INVALID_ARGUMENT', resultSummary: 'exception_invalid_argument' });
    expectNoAuditLeak(writer);
  });

  it('returns the unchanged missing report response and records tool.end NOT_FOUND', async () => {
    const outputDir = await tempOutputDir();
    const writer = new RecordingAuditSpanWriter();
    const response = await executeAgentToolRequest(request('publicTraffic.latestSummary'), outputDir, auditOptions(writer));

    expect(response).toEqual({ text: '还没有找到公域日报上下文。' });
    const span = closedSpan(writer, 'publicTraffic.latestSummary');
    expect(span.terminal).toMatchObject({ event: 'tool.end', status: 'NOT_FOUND', resultSummary: 'report_context_missing' });
    expectNoAuditLeak(writer);
  });

  it('closes a span for each exact selected audit tool using safe fixtures and mocks', async () => {
    expect(SELECTED_AUDIT_TOOL_NAMES).toEqual([
      'publicTraffic.latestSummary',
      'publicTraffic.conversionSummary',
      'publicTraffic.reportQuery',
      'productLink.query',
      'publicTraffic.problemProducts',
      'publicTraffic.orderSummary',
      'system.dataHealth',
      'publicTraffic.resendLatestReport',
      'publicTraffic.pushLatestReportToGroup',
      'publicTraffic.runReport',
      'publicTraffic.refreshDashboard',
    ]);

    const reportSetup = (outputDir: string) => writeReport(outputDir);
    await expectClosedSpanFor('publicTraffic.latestSummary', {}, reportSetup);
    await expectClosedSpanFor('publicTraffic.conversionSummary', {}, reportSetup);
    await expectClosedSpanFor('publicTraffic.reportQuery', { target: 'summary' }, reportSetup);
    await expectClosedSpanFor('productLink.query', { queryType: 'productList', limit: 1 }, reportSetup);
    await expectClosedSpanFor('publicTraffic.problemProducts', { problemType: 'weak_conversion' }, reportSetup);
    await expectClosedSpanFor('publicTraffic.orderSummary', {}, reportSetup);
    await expectClosedSpanFor('system.dataHealth', { date: '2026-07-21' }, (outputDir) => writeDataHealthFiles(outputDir));
    await expectClosedSpanFor('publicTraffic.resendLatestReport', {}, reportSetup);
    await expectClosedSpanFor('publicTraffic.pushLatestReportToGroup', {}, reportSetup);
    await expectClosedSpanFor('publicTraffic.runReport');
    await expectClosedSpanFor('publicTraffic.refreshDashboard', { date: '2026-07-21' });
  });

  it('maps product detail zero match to NOT_FOUND while list and query successes are OK', async () => {
    const outputDir = await tempOutputDir();
    await writeReport(outputDir);
    const writer = new RecordingAuditSpanWriter();
    await executeAgentToolRequest(request('productLink.query', { queryType: 'productDetail', productQuery: '999999' }), outputDir, auditOptions(writer));
    await executeAgentToolRequest(request('productLink.query', { queryType: 'productList', limit: 1 }), outputDir, auditOptions(writer));
    await executeAgentToolRequest(request('publicTraffic.reportQuery', { target: 'summary' }), outputDir, auditOptions(writer));

    const terminals = writer.events.filter((event) => event.event === 'tool.end');
    expect(terminals.map((event) => [event.toolName, event.status, event.resultSummary])).toEqual([
      ['productLink.query', 'NOT_FOUND', 'product_query product_detail matches=0'],
      ['productLink.query', 'OK', 'product_query product_list matches=2'],
      ['publicTraffic.reportQuery', 'OK', 'report_context_available'],
    ]);
    expectNoAuditLeak(writer);
  });

  it('records data-health clean and blocked outcomes from safe facts only', async () => {
    const cleanDir = await tempOutputDir();
    await writeDataHealthFiles(cleanDir);
    const blockedDir = await tempOutputDir();
    await writeDataHealthFiles(blockedDir, { blocked: true });
    const writer = new RecordingAuditSpanWriter();

    await executeAgentToolRequest(request('system.dataHealth', { date: '2026-07-21' }), cleanDir, auditOptions(writer));
    await executeAgentToolRequest(request('system.dataHealth', { date: '2026-07-21' }), blockedDir, auditOptions(writer));

    expect(writer.events.filter((event) => event.event === 'tool.end').map((event) => [event.status, event.resultSummary])).toEqual([
      ['OK', 'data_health_clean issues=0 stale_sources=0'],
      ['FAILED_PRECONDITION', 'data_health_blocked issues=2 stale_sources=1'],
    ]);
    expectNoAuditLeak(writer);
  });

  it('maps resend and push sent=false to UNAVAILABLE without reason, recipient, or card leakage', async () => {
    const outputDir = await tempOutputDir();
    await writeReport(outputDir);
    mocks.sendFeishuCard.mockResolvedValue({ sent: false, channel: 'none', reason: 'secret delivery reason token=secret ou_sensitive_recipient card_secret_marker' });
    const writer = new RecordingAuditSpanWriter();

    await executeAgentToolRequest(request('publicTraffic.resendLatestReport', { sendTo: 'group' }), outputDir, auditOptions(writer));
    await executeAgentToolRequest(request('publicTraffic.pushLatestReportToGroup'), outputDir, auditOptions(writer));

    expect(writer.events.filter((event) => event.event === 'tool.end').map((event) => [event.toolName, event.status, event.resultSummary])).toEqual([
      ['publicTraffic.resendLatestReport', 'UNAVAILABLE', 'delivery_provider_error'],
      ['publicTraffic.pushLatestReportToGroup', 'UNAVAILABLE', 'delivery_provider_error'],
    ]);
    expectNoAuditLeak(writer);
  });

  it('records runReport success, partial first-send, and concurrent already-running FAILED_PRECONDITION', async () => {
    let runReportStartCount = 0;
    const writer = new RecordingAuditSpanWriter((input) => {
      if (input.toolName !== 'publicTraffic.runReport') return;
      runReportStartCount += 1;
      if (runReportStartCount === 1) expect(mocks.runPublicTrafficReportCli).not.toHaveBeenCalled();
    });
    await executeAgentToolRequest(request('publicTraffic.runReport'), await tempOutputDir(), auditOptions(writer));
    mocks.runPublicTrafficReportCli.mockResolvedValueOnce(successfulRunReportResult({ dashboardCrawlSummary: undefined, firstReportSent: false }));
    await executeAgentToolRequest(request('publicTraffic.runReport'), await tempOutputDir(), auditOptions(writer));

    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    mocks.runPublicTrafficReportCli.mockImplementationOnce(() => new Promise((resolve) => {
      markStarted();
      release = () => resolve(successfulRunReportResult({ dashboardCrawlSummary: 'done' }));
    }));
    const first = executeAgentToolRequest(request('publicTraffic.runReport'), await tempOutputDir(), auditOptions(writer));
    await started;
    const second = executeAgentToolRequest(request('publicTraffic.runReport'), await tempOutputDir(), auditOptions(writer));
    await vi.waitFor(() => expect(writer.events.some((event) => event.event === 'tool.end' && event.resultSummary === 'run_report_already_running')).toBe(true));
    release();
    await Promise.all([first, second]);

    const terminalCounts = new Map<string, number>();
    for (const [status, resultSummary] of writer.events.filter((event) => event.event === 'tool.end').map((event) => [event.status, event.resultSummary])) {
      const key = `${status}:${resultSummary}`;
      terminalCounts.set(key, (terminalCounts.get(key) ?? 0) + 1);
    }
    expect(Object.fromEntries(terminalCounts)).toEqual({
      'OK:run_report_first_report_sent': 2,
      'UNKNOWN:run_report_first_report_unsent': 1,
      'FAILED_PRECONDITION:run_report_already_running': 1,
    });
    expectNoAuditLeak(writer);
  });

  it('records refresh repaired, still-missing, and saved-historical-without-report statuses with report entities', async () => {
    const writer = new RecordingAuditSpanWriter();
    for (const status of ['repaired', 'still_missing', 'saved_historical_without_report'] as const) {
      mocks.runDashboardRefresh.mockResolvedValueOnce(refreshResult(status));
      await executeAgentToolRequest(request('publicTraffic.refreshDashboard', { date: '2026-07-21' }), await tempOutputDir(), auditOptions(writer));
    }

    expect(writer.events.filter((event) => event.event === 'tool.end').map((event) => [event.status, event.resultSummary, event.entity])).toEqual([
      ['OK', 'refresh_repaired', { type: 'report', id: '2026-07-21' }],
      ['FAILED_PRECONDITION', 'refresh_still_missing', { type: 'report', id: '2026-07-21' }],
      ['NOT_FOUND', 'refresh_saved_historical_without_report', { type: 'report', id: '2026-07-21' }],
    ]);
    expectNoAuditLeak(writer);
  });

  it('creates no span for nonallowlisted system.help', async () => {
    const writer = new RecordingAuditSpanWriter();
    const activations: string[] = [];
    const response = await executeAgentToolRequest(request('system.help'), await tempOutputDir(), auditOptions(writer, activations));

    expect(response.text).toContain('可用能力概览');
    expect(activations).toEqual(['system.help']);
    expect(writer.events).toEqual([]);
  });

  it('does not fall back to base audit context when an activator exists but returns no child context', async () => {
    const outputDir = await tempOutputDir();
    await writeReport(outputDir);
    const expected = await executeAgentToolRequest(request('publicTraffic.latestSummary'), outputDir);

    for (const activateAudit of [async () => undefined, async () => { throw undefined; }]) {
      const writer = new RecordingAuditSpanWriter();
      const response = await executeAgentToolRequest(request('publicTraffic.latestSummary'), outputDir, {
        auditContext: auditContext(),
        auditLogger: writer,
        activateAudit,
      });
      expect(response).toEqual(expected);
      expect(writer.events).toEqual([]);
    }
  });

  it('does not let audit start failure alter a selected success response', async () => {
    const successDir = await tempOutputDir();
    await writeReport(successDir);
    const expected = await executeAgentToolRequest(request('publicTraffic.latestSummary'), successDir);

    await expect(executeAgentToolRequest(request('publicTraffic.latestSummary'), successDir, auditOptions(new StartFailingAuditSpanWriter()))).resolves.toEqual(expected);
  });

  it('does not let audit end failure alter a selected success response', async () => {
    const successDir = await tempOutputDir();
    await writeReport(successDir);
    const expected = await executeAgentToolRequest(request('publicTraffic.latestSummary'), successDir);

    await expect(executeAgentToolRequest(request('publicTraffic.latestSummary'), successDir, auditOptions(new EndFailingAuditSpanWriter()))).resolves.toEqual(expected);
  });

  it('does not let audit error failure alter original rejection identity', async () => {
    const expectedError = new Error('business runReport failure token=secret');
    mocks.runPublicTrafficReportCli.mockRejectedValueOnce(expectedError);

    await expect(executeAgentToolRequest(request('publicTraffic.runReport'), await tempOutputDir(), auditOptions(new ErrorFailingAuditSpanWriter()))).rejects.toBe(expectedError);
  });

  it('preserves exact BotResponse equality for latest and refresh with and without audit', async () => {
    const latestDir = await tempOutputDir();
    await writeReport(latestDir);
    const latestWithoutAudit = await executeAgentToolRequest(request('publicTraffic.latestSummary'), latestDir);
    const latestWithAudit = await executeAgentToolRequest(request('publicTraffic.latestSummary'), latestDir, auditOptions(new RecordingAuditSpanWriter()));
    expect(latestWithAudit).toEqual(latestWithoutAudit);

    mocks.runDashboardRefresh.mockResolvedValue(refreshResult('repaired'));
    const refreshWithoutAudit = await executeAgentToolRequest(request('publicTraffic.refreshDashboard', { date: '2026-07-21' }), await tempOutputDir());
    mocks.runDashboardRefresh.mockResolvedValue(refreshResult('repaired'));
    const refreshWithAudit = await executeAgentToolRequest(request('publicTraffic.refreshDashboard', { date: '2026-07-21' }), await tempOutputDir(), auditOptions(new RecordingAuditSpanWriter()));
    expect(refreshWithAudit).toEqual(refreshWithoutAudit);
  });

  it('activates initial runReport and refresh confirmations via handleBotIntent without executor tool spans or card mutation', async () => {
    const runWriter = new RecordingAuditSpanWriter();
    const runActivations: string[] = [];
    const runWithoutAudit = await handleBotIntent({ type: 'run_public_traffic_report' }, await tempOutputDir());
    const runWithAudit = await handleBotIntent({ type: 'run_public_traffic_report' }, await tempOutputDir(), auditOptions(runWriter, runActivations));
    expect(runActivations).toEqual(['publicTraffic.runReport']);
    expect(runWriter.events).toEqual([]);
    expect(runWithAudit).toEqual(runWithoutAudit);

    const refreshWriter = new RecordingAuditSpanWriter();
    const refreshActivations: string[] = [];
    const refreshWithoutAudit = await handleBotIntent({ type: 'refresh_public_traffic_dashboard', date: '2026-07-21', sendTo: 'group' }, await tempOutputDir());
    const refreshWithAudit = await handleBotIntent({ type: 'refresh_public_traffic_dashboard', date: '2026-07-21', sendTo: 'group' }, await tempOutputDir(), auditOptions(refreshWriter, refreshActivations));
    expect(refreshActivations).toEqual(['publicTraffic.refreshDashboard']);
    expect(refreshWriter.events).toEqual([]);
    expect(refreshWithAudit).toEqual(refreshWithoutAudit);
  });
});
