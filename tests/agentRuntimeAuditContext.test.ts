import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAuditEvent, serializeAuditEvent } from '../src/audit/event.js';
import { createAgentRuntime } from '../src/agentRuntime/runtime.js';
import type { AuditContext, AuditRecordResult, CanonicalAuditEvent, CanonicalAuditEventName, CanonicalAuditStatus } from '../src/audit/types.js';
import type { AgentAuditDependencies, AgentRequest } from '../src/agentRuntime/types.js';
import { createFeishuMessageDispatcher, MESSAGE_ID_CLAIMED_METADATA_KEY } from '../src/feishuBot/dispatcher.js';
import { executeAgentToolRequest, type AgentToolExecutionOptions } from '../src/feishuBot/agentToolExecutor.js';
import type { BotIntent, BotResponse } from '../src/feishuBot/types.js';

interface RuntimeAuditRecordInput {
  traceId: string;
  spanId: string;
  event: CanonicalAuditEventName;
  toolName: string;
  status: CanonicalAuditStatus;
  resultSummary: string;
  context?: AuditContext;
  parentSpanId?: string;
  durationMs?: number;
  error?: unknown;
  tags?: string[];
}

const entryTime = '2026-07-21T08:00:00.000Z';
const laterTime = '2026-07-21T08:00:01.000Z';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tempDirs: string[] = [];
const period = {
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
};

const reportContext = {
  date: '2026-06-11',
  summary: {
    '1d': { exposure: 100, publicVisits: 20, dashboardVisits: 18, createdOrders: 2, shippedOrders: 1, amount: 88, exposureVisitRate: 0.2, visitCreatedOrderRate: 0.1, visitShipmentRate: 0.05 },
    '7d': { exposure: 700, publicVisits: 120, dashboardVisits: 110, createdOrders: 12, shippedOrders: 8, amount: 500, exposureVisitRate: 0.17, visitCreatedOrderRate: 0.1, visitShipmentRate: 0.067 },
    '30d': { exposure: 3000, publicVisits: 500, dashboardVisits: 480, createdOrders: 40, shippedOrders: 25, amount: 2000, exposureVisitRate: 0.167, visitCreatedOrderRate: 0.08, visitShipmentRate: 0.05 },
  },
  conclusions: [],
  rows: [{ productName: 'Test Product', platformProductId: '2000000000000000000001', displayProductId: '端内ID 565', custodyDays: 10, periods: { '1d': period, '7d': period, '30d': period } }],
  lowExposure: [],
  weakClick: [],
  weakConversion: [],
  highPotential: [],
  newProductObservation: [],
  lifecycleGovernance: [],
  recommendedActions: [],
  emptySectionNotes: {},
};

class InMemoryAuditRecorder {
  readonly events: CanonicalAuditEvent[] = [];
  readonly serialized: string[] = [];

  async record(input: RuntimeAuditRecordInput): Promise<AuditRecordResult> {
    return this.recordAt(input, new Date(laterTime));
  }

  async recordAt(input: RuntimeAuditRecordInput, occurredAt: Date): Promise<AuditRecordResult> {
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
      ...(input.error !== undefined ? { error: input.error } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
    });
    this.events.push(event);
    const payload = serializeAuditEvent(event);
    this.serialized.push(payload);
    return { ok: true, payload };
  }
}

class ThrowingAuditRecorder {
  async record(): Promise<AuditRecordResult> {
    throw new Error('record failed');
  }

  async recordAt(): Promise<AuditRecordResult> {
    throw new Error('recordAt failed');
  }
}

afterEach(async () => {
  vi.useRealTimers();
  const dirs = tempDirs.splice(0);
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

function feishuRequest(overrides: Partial<AgentRequest> = {}): AgentRequest {
  return {
    source: 'feishu',
    text: '今日概况',
    actor: { id: 'ou_actor_alpha', name: 'Operator Alpha' },
    channel: { id: 'oc_chat_alpha', type: 'group' },
    metadata: { messageId: 'om_message_alpha', transport: 'sdk', nested: { keep: true } },
    ...overrides,
  };
}

function createRuntime(input: {
  recorder?: InMemoryAuditRecorder;
  handleIntent?: (intent: BotIntent, outputDir: string | undefined, dependencies: AgentAuditDependencies) => Promise<BotResponse>;
  traceIds?: string[];
  spanIds?: string[];
}) {
  let traceIndex = 0;
  let spanIndex = 0;
  const recorder = input.recorder ?? new InMemoryAuditRecorder();
  const config = {
    outputDir: 'tmp/task-5-runtime',
    resolveIntent: (text: string): BotIntent => text === 'not selected' ? { type: 'unknown', text } : { type: 'latest_summary' },
    handleIntent: input.handleIntent ?? (async (_intent, _outputDir, dependencies) => {
      await dependencies?.activateAudit('publicTraffic.latestSummary');
      return { text: 'selected result' };
    }),
    auditLogger: recorder,
    now: () => new Date(entryTime),
    makeTraceId: () => input.traceIds?.[traceIndex++] ?? 'trace-entry-1',
    makeSpanId: () => input.spanIds?.[spanIndex++] ?? `span-entry-${spanIndex}`,
  };
  return { runtime: createAgentRuntime(config), recorder };
}

function eventNames(recorder: InMemoryAuditRecorder): CanonicalAuditEventName[] {
  return recorder.events.map((event) => event.event);
}

function requireDependency(dependencies: AgentAuditDependencies | undefined): AgentAuditDependencies {
  expect(dependencies).toBeDefined();
  if (dependencies === undefined) throw new Error('missing runtime audit dependencies');
  return dependencies;
}

function deferredResponse() {
  let resolveResponse!: (response: BotResponse) => void;
  const promise = new Promise<BotResponse>((resolve) => {
    resolveResponse = resolve;
  });
  return { promise, resolve: resolveResponse };
}

async function writeReportContext(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mt-agent-task5-audit-'));
  tempDirs.push(dir);
  await mkdir(join(dir, '2026-06-11'), { recursive: true });
  await writeFile(join(dir, '2026-06-11', 'report-context.json'), JSON.stringify(reportContext), 'utf8');
  return dir;
}

describe('Task 5 explicit AuditContext runtime lifecycle', () => {
  it('passes explicit third-argument audit dependencies into handleIntent with AgentRequest facts and stable pseudonymized user id', async () => {
    const request = feishuRequest();
    const metadataBefore = JSON.stringify(request.metadata);
    let capturedContext: AuditContext | undefined;
    const { runtime, recorder } = createRuntime({
      recorder: new InMemoryAuditRecorder(),
      traceIds: ['trace-fixed-alpha'],
      handleIntent: vi.fn(async (_intent, _outputDir, dependencies) => {
        const audit = requireDependency(dependencies);
        capturedContext = audit.auditContext;
        await audit.activateAudit('publicTraffic.latestSummary');
        return { text: 'selected result' };
      }),
    });

    await expect(runtime.handle(request)).resolves.toEqual({ text: 'selected result' });

    expect(capturedContext).toMatchObject({
      source: 'feishu',
      actorAvailable: true,
      rawActorId: 'ou_actor_alpha',
      channel: 'sdk',
      channelType: 'group',
      rawChannelId: 'oc_chat_alpha',
      messageId: 'om_message_alpha',
      traceId: 'trace-fixed-alpha',
      requestStartedAt: entryTime,
    });
    expect(JSON.stringify(request.metadata)).toBe(metadataBefore);
    expect(recorder.events.at(-1)?.user_id).toMatch(/^usr_[a-f0-9]{32}$/);
  });

  it('does not mutate request metadata and lazily records no events for nonselected requests', async () => {
    const request = feishuRequest({ text: 'not selected', metadata: { messageId: 'om_nonselected', transport: 'http', mutable: ['keep'] } });
    const metadataBefore = JSON.stringify(request.metadata);
    const { runtime, recorder } = createRuntime({
      handleIntent: vi.fn(async () => ({ text: 'unknown', metadata: { selected: false } })),
    });

    await expect(runtime.handle(request)).resolves.toEqual({ text: 'unknown', metadata: { selected: false } });

    expect(eventNames(recorder)).toEqual([]);
    expect(JSON.stringify(request.metadata)).toBe(metadataBefore);
  });

  it('records selected activation success in run.start, agent.start, agent.end, run.final_result order with the entry trace and timestamp', async () => {
    const { runtime, recorder } = createRuntime({ traceIds: ['trace-success'], spanIds: ['run-span', 'agent-span', 'run-final-span'] });

    await expect(runtime.handle(feishuRequest())).resolves.toEqual({ text: 'selected result' });

    expect(eventNames(recorder)).toEqual(['run.start', 'agent.start', 'agent.end', 'run.final_result']);
    expect(recorder.events.map((event) => event.trace_id)).toEqual(['trace-success', 'trace-success', 'trace-success', 'trace-success']);
    expect(recorder.events[0]).toMatchObject({ ts: entryTime, span_id: 'run-span', tool_name: 'agent.runtime' });
    expect(recorder.events[1]).toMatchObject({ ts: entryTime, span_id: 'agent-span', parent_span_id: 'run-span', tool_name: 'agent.runtime' });
  });

  it('returns one frozen child AuditContext parented to the agent span for repeated selected activation calls', async () => {
    const activationContexts: Array<AuditContext | undefined> = [];
    const { runtime, recorder } = createRuntime({
      traceIds: ['trace-child-context'],
      spanIds: ['run-span', 'agent-span'],
      handleIntent: vi.fn(async (_intent, _outputDir, dependencies) => {
        const audit = requireDependency(dependencies);
        activationContexts.push(await audit.activateAudit('publicTraffic.latestSummary'));
        activationContexts.push(await audit.activateAudit('publicTraffic.latestSummary'));
        return { text: 'selected result' };
      }),
    });

    await expect(runtime.handle(feishuRequest())).resolves.toEqual({ text: 'selected result' });

    expect(eventNames(recorder)).toEqual(['run.start', 'agent.start', 'agent.end', 'run.final_result']);
    expect(activationContexts[0]).toBe(activationContexts[1]);
    expect(Object.isFrozen(activationContexts[0])).toBe(true);
    expect(activationContexts[0]).toMatchObject({ traceId: 'trace-child-context', parentSpanId: 'agent-span' });
    expect(activationContexts[0]).not.toBeUndefined();
  });

  it('returns undefined for nonselected activation and when no audit logger is configured', async () => {
    const nonselectedContexts: Array<AuditContext | undefined> = [];
    const nonselected = createRuntime({
      handleIntent: vi.fn(async (_intent, _outputDir, dependencies) => {
        nonselectedContexts.push(await requireDependency(dependencies).activateAudit('unknown.tool'));
        return { text: 'nonselected tool' };
      }),
    });

    await expect(nonselected.runtime.handle(feishuRequest())).resolves.toEqual({ text: 'nonselected tool' });
    expect(nonselectedContexts).toEqual([undefined]);
    expect(eventNames(nonselected.recorder)).toEqual([]);

    const noLoggerContexts: Array<AuditContext | undefined> = [];
    const runtime = createAgentRuntime({
      outputDir: 'tmp/task-5-runtime',
      resolveIntent: (): BotIntent => ({ type: 'latest_summary' }),
      handleIntent: vi.fn(async (_intent, _outputDir, dependencies) => {
        noLoggerContexts.push(await dependencies.activateAudit('publicTraffic.latestSummary'));
        return { text: 'no logger' };
      }),
    });

    await expect(runtime.handle(feishuRequest())).resolves.toEqual({ text: 'no logger' });
    expect(noLoggerContexts).toEqual([undefined]);
  });

  it('records agent.error before run.failed and preserves the original handler rejection', async () => {
    const expectedError = new Error('handler exploded');
    const { runtime, recorder } = createRuntime({
      handleIntent: vi.fn(async (_intent, _outputDir, dependencies) => {
        await requireDependency(dependencies).activateAudit('publicTraffic.latestSummary');
        throw expectedError;
      }),
    });

    await expect(runtime.handle(feishuRequest())).rejects.toBe(expectedError);

    expect(eventNames(recorder)).toEqual(['run.start', 'agent.start', 'agent.error', 'run.failed']);
    expect(recorder.events[2]).toMatchObject({ event: 'agent.error', status: 'INTERNAL' });
    expect(recorder.events[3]).toMatchObject({ event: 'run.failed', status: 'INTERNAL' });
  });

  it('falls back when clock and audit id factories throw or return invalid values', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(entryTime));
    const recorder = new InMemoryAuditRecorder();
    let traceCall = 0;
    let spanCall = 0;
    const runtime = createAgentRuntime({
      outputDir: 'tmp/task-5-runtime',
      resolveIntent: (): BotIntent => ({ type: 'latest_summary' }),
      handleIntent: vi.fn(async (_intent, _outputDir, dependencies) => {
        await dependencies.activateAudit('publicTraffic.latestSummary');
        return { text: 'selected despite invalid factories' };
      }),
      auditLogger: recorder,
      now: () => new Date('not-a-date'),
      makeTraceId: () => {
        traceCall += 1;
        if (traceCall === 1) return 'ou_raw_trace';
        throw new Error('trace factory failed');
      },
      makeSpanId: () => {
        spanCall += 1;
        if (spanCall === 1) return '.';
        return 'span with spaces';
      },
    });

    await expect(runtime.handle(feishuRequest())).resolves.toEqual({ text: 'selected despite invalid factories' });

    expect(eventNames(recorder)).toEqual(['run.start', 'agent.start', 'agent.end', 'run.final_result']);
    expect(recorder.events[0]?.ts).toBe(entryTime);
    expect(recorder.events[0]?.trace_id).toMatch(uuidPattern);
    expect(recorder.events[0]?.trace_id).not.toBe('ou_raw_trace');
    expect(recorder.events[0]?.span_id).toMatch(uuidPattern);
    expect(recorder.events[1]?.span_id).toMatch(uuidPattern);
  });

  it('falls back when trace and span factories throw before audit activation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(entryTime));
    const recorder = new InMemoryAuditRecorder();
    const runtime = createAgentRuntime({
      outputDir: 'tmp/task-5-runtime',
      resolveIntent: (): BotIntent => ({ type: 'latest_summary' }),
      handleIntent: vi.fn(async (_intent, _outputDir, dependencies) => {
        await dependencies.activateAudit('publicTraffic.latestSummary');
        return { text: 'selected despite throwing factories' };
      }),
      auditLogger: recorder,
      makeTraceId: () => { throw new Error('trace failed'); },
      makeSpanId: () => { throw new Error('span failed'); },
    });

    await expect(runtime.handle(feishuRequest())).resolves.toEqual({ text: 'selected despite throwing factories' });

    expect(eventNames(recorder)).toEqual(['run.start', 'agent.start', 'agent.end', 'run.final_result']);
    expect(recorder.events[0]?.trace_id).toMatch(uuidPattern);
    expect(recorder.events[0]?.span_id).toMatch(uuidPattern);
    expect(recorder.events[1]?.span_id).toMatch(uuidPattern);
  });

  it('preserves selected business response when audit writer recordAt and record throw', async () => {
    let activationContext: AuditContext | undefined;
    const runtime = createAgentRuntime({
      outputDir: 'tmp/task-5-runtime',
      resolveIntent: (): BotIntent => ({ type: 'latest_summary' }),
      handleIntent: vi.fn(async (_intent, _outputDir, dependencies) => {
        activationContext = await dependencies.activateAudit('publicTraffic.latestSummary');
        return { text: 'selected response unchanged' };
      }),
      auditLogger: new ThrowingAuditRecorder(),
      now: () => new Date(entryTime),
      makeTraceId: () => 'trace-writer-failure',
      makeSpanId: () => 'span-writer-failure',
    });

    await expect(runtime.handle(feishuRequest())).resolves.toEqual({ text: 'selected response unchanged' });
    expect(activationContext).toBeUndefined();
  });

  it('classifies waiting cards structurally as run.waiting_user while nonblocking cards finish with run.final_result', async () => {
    const waiting = createRuntime({
      handleIntent: vi.fn(async (_intent, _outputDir, dependencies) => {
        await requireDependency(dependencies).activateAudit('publicTraffic.latestSummary');
        return { text: 'approval required', card: { schema: '2.0' }, metadata: { cardMode: 'confirmation', confirmationKey: 'confirm-1' } };
      }),
    });
    await expect(waiting.runtime.handle(feishuRequest())).resolves.toMatchObject({ text: 'approval required' });
    expect(eventNames(waiting.recorder)).toEqual(['run.start', 'agent.start', 'agent.end', 'run.waiting_user']);

    const nonblocking = createRuntime({
      handleIntent: vi.fn(async (_intent, _outputDir, dependencies) => {
        await requireDependency(dependencies).activateAudit('publicTraffic.latestSummary');
        return { text: 'card result', card: { schema: '2.0' }, metadata: { cardMode: 'nonBlocking' } };
      }),
    });
    await expect(nonblocking.runtime.handle(feishuRequest())).resolves.toMatchObject({ text: 'card result' });
    expect(eventNames(nonblocking.recorder)).toEqual(['run.start', 'agent.start', 'agent.end', 'run.final_result']);
  });

  it('serializes stable pseudonyms without raw actor, chat, or message ids', async () => {
    const { runtime, recorder } = createRuntime({ traceIds: ['trace-redaction'] });

    await runtime.handle(feishuRequest());

    const userIds = recorder.events.map((event) => event.user_id).filter((userId): userId is string => userId !== undefined);
    expect(new Set(userIds).size).toBe(1);
    expect(userIds[0]).toMatch(/^usr_[a-f0-9]{32}$/);
    expect(recorder.serialized.join('\n')).not.toContain('ou_actor_alpha');
    expect(recorder.serialized.join('\n')).not.toContain('oc_chat_alpha');
    expect(recorder.serialized.join('\n')).not.toContain('om_message_alpha');
  });

  it('keeps concurrent request audit contexts isolated without global context or metadata side channels', async () => {
    const firstGate = deferredResponse();
    const secondGate = deferredResponse();
    const captured: AuditContext[] = [];
    const { runtime, recorder } = createRuntime({
      traceIds: ['trace-first', 'trace-second'],
      handleIntent: vi.fn(async (_intent, _outputDir, dependencies) => {
        const audit = requireDependency(dependencies);
        captured.push(audit.auditContext);
        const captureIndex = captured.length;
        await audit.activateAudit('publicTraffic.latestSummary');
        return captureIndex === 1 ? firstGate.promise : secondGate.promise;
      }),
    });

    const first = runtime.handle(feishuRequest({ actor: { id: 'ou_first' }, channel: { id: 'oc_first', type: 'direct' }, metadata: { messageId: 'om_first', transport: 'sdk' } }));
    const second = runtime.handle(feishuRequest({ actor: { id: 'ou_second' }, channel: { id: 'oc_second', type: 'group' }, metadata: { messageId: 'om_second', transport: 'http' } }));
    secondGate.resolve({ text: 'second done' });
    firstGate.resolve({ text: 'first done' });

    await expect(Promise.all([first, second])).resolves.toEqual([{ text: 'first done' }, { text: 'second done' }]);

    expect(captured.map((context) => [context.rawActorId, context.rawChannelId, context.messageId, context.channel, context.traceId])).toEqual([
      ['ou_first', 'oc_first', 'om_first', 'sdk', 'trace-first'],
      ['ou_second', 'oc_second', 'om_second', 'http', 'trace-second'],
    ]);
    expect(recorder.events.filter((event) => event.trace_id === 'trace-first').every((event) => event.channel === 'sdk')).toBe(true);
    expect(recorder.events.filter((event) => event.trace_id === 'trace-second').every((event) => event.channel === 'http')).toBe(true);
  });

  it('activates the actual default direct latest summary handler with the runtime AuditContext', async () => {
    const outputDir = await writeReportContext();
    const recorder = new InMemoryAuditRecorder();
    const runtime = createAgentRuntime({
      outputDir,
      resolveIntent: (): BotIntent => ({ type: 'latest_summary' }),
      auditLogger: recorder,
      now: () => new Date(entryTime),
      makeTraceId: () => 'trace-direct',
      makeSpanId: () => 'span-direct',
    });

    const response = await runtime.handle(feishuRequest());

    expect(response.text).toContain('公域日报 2026-06-11');
    expect(eventNames(recorder)).toEqual(['run.start', 'agent.start', 'agent.end', 'run.final_result']);
    expect(recorder.events[0]?.trace_id).toBe('trace-direct');
    expect(recorder.events[0]?.channel).toBe('sdk');
    expect(recorder.events[0]?.user_id).toMatch(/^usr_[a-f0-9]{32}$/);
  });

  it('passes Feishu request facts through dispatcher-created runtime into direct handler activation', async () => {
    const outputDir = await writeReportContext();
    const recorder = new InMemoryAuditRecorder();
    const dispatcher = createFeishuMessageDispatcher({ outputDir, auditLogger: recorder, botMentionName: 'MT Bot' });

    const response = await dispatcher.dispatch({
      messageId: 'om_dispatch_task5',
      chatId: 'oc_dispatch_task5',
      chatType: 'group',
      senderOpenId: 'ou_dispatch_task5',
      text: '@MT Bot 今日概况',
      source: 'sdk',
      mentions: [{ key: '@MT Bot', name: 'MT Bot' }],
      metadata: { [MESSAGE_ID_CLAIMED_METADATA_KEY]: true },
    });

    expect(response.skipped).toBe(false);
    expect(response.text).toContain('公域日报 2026-06-11');
    expect(eventNames(recorder)).toEqual(['run.start', 'agent.start', 'agent.end', 'run.final_result']);
    expect(recorder.events[0]).toMatchObject({ channel: 'sdk' });
    expect(recorder.serialized.join('\n')).not.toContain('ou_dispatch_task5');
    expect(recorder.serialized.join('\n')).not.toContain('oc_dispatch_task5');
    expect(recorder.serialized.join('\n')).not.toContain('om_dispatch_task5');
  });

  it('activates executor entry via explicit AgentToolExecutionOptions fields without emitting tool lifecycle events', async () => {
    const outputDir = await writeReportContext();
    const auditContext: AuditContext = {
      source: 'feishu',
      actorAvailable: true,
      rawActorId: 'ou_actor_alpha',
      channel: 'sdk',
      channelType: 'group',
      rawChannelId: 'oc_chat_alpha',
      messageId: 'om_message_alpha',
      traceId: 'trace-options',
      requestStartedAt: entryTime,
    };
    const recorder = new InMemoryAuditRecorder();
    const activations: string[] = [];
    const options: AgentToolExecutionOptions = {
      auditContext,
      auditLogger: recorder,
      activateAudit: async (toolName) => {
        activations.push(toolName);
        return auditContext;
      },
    };

    const response = await executeAgentToolRequest({ toolName: 'publicTraffic.latestSummary', arguments: {}, reason: 'direct executor assertion' }, outputDir, options);

    expect(response.text).toContain('公域日报 2026-06-11');
    expect(options.auditContext).toBe(auditContext);
    expect(options.auditLogger).toBe(recorder);
    expect(options.activateAudit).toEqual(expect.any(Function));
    expect(activations).toEqual(['publicTraffic.latestSummary']);
    expect(eventNames(recorder)).toEqual([]);
  });

  it('activates selected planner confirmation before returning a waiting response', async () => {
    const recorder = new InMemoryAuditRecorder();
    const runtime = createAgentRuntime({
      outputDir: await writeReportContext(),
      agentPlannerProvider: {
        proposePlan: vi.fn(async () => JSON.stringify({
          goal: 'run public traffic report',
          selectedTool: 'publicTraffic.runReport',
          arguments: {},
          confidence: 0.92,
          reason: '用户要求生成并发送公域日报',
          requiresConfirmation: true,
        })),
      },
      auditLogger: recorder,
      now: () => new Date(entryTime),
      makeTraceId: () => 'trace-confirmation',
      makeSpanId: () => 'span-confirmation',
    });

    const response = await runtime.handle(feishuRequest({ text: '帮我跑今天公域日报' }));

    expect(response.text).toContain('请确认 Agent 操作：publicTraffic.runReport');
    expect(response.card).toBeDefined();
    expect(eventNames(recorder)).toEqual(['run.start', 'agent.start', 'agent.end', 'run.waiting_user']);
  });
});
