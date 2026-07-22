import { describe, expect, it } from 'vitest';
import { CANONICAL_AUDIT_EVENTS, CANONICAL_AUDIT_STATUSES } from '../src/audit/event.js';
import { buildAuditEvent, buildAuditContext, pseudonymizeAuditUserId, serializeAuditEvent } from '../src/audit/event.js';
import type { AuditChannel, AuditEventInput, CanonicalAuditEventName, CanonicalAuditStatus } from '../src/audit/types.js';

const canonicalEvents = [
  'run.start',
  'run.resume',
  'run.waiting_user',
  'run.final_result',
  'run.failed',
  'agent.start',
  'agent.end',
  'agent.error',
  'tool.start',
  'tool.end',
  'tool.error',
];

const canonicalStatuses = [
  'OK',
  'CANCELLED',
  'UNKNOWN',
  'INVALID_ARGUMENT',
  'DEADLINE_EXCEEDED',
  'NOT_FOUND',
  'FAILED_PRECONDITION',
  'PERMISSION_DENIED',
  'UNAVAILABLE',
  'INTERNAL',
];

function baseInput(overrides: Partial<AuditEventInput> = {}): AuditEventInput {
  return {
    ts: '2026-07-21T08:30:00.000Z',
    agentId: 'mt-agent',
    traceId: 'trace-1',
    spanId: 'span-1',
    event: 'tool.end',
    toolName: 'publicTraffic.latestSummary',
    status: 'OK',
    resultSummary: 'latest summary ready',
    context: buildAuditContext({
      source: 'feishu',
      actorAvailable: true,
      rawActorId: 'ou_actor_123',
      channel: 'sdk',
      channelType: 'direct',
      rawChannelId: 'oc_chat_456',
      messageId: 'om_message_789',
      requestRef: 'request-1',
      clarificationRef: 'clarify-1',
      runId: 'run-1',
      decisionId: 'decision-1',
      traceId: 'trace-1',
      requestStartedAt: '2026-07-21T08:29:59.000Z',
      parentSpanId: 'agent-span-1',
    }),
    ...overrides,
  };
}

describe('audit event contract', () => {
  it('exposes event and status as literal union types', () => {
    const eventName: CanonicalAuditEventName = 'tool.end';
    const status: CanonicalAuditStatus = 'OK';
    const channel: AuditChannel = 'sdk';

    expect(eventName).toBe('tool.end');
    expect(status).toBe('OK');
    expect(channel).toBe('sdk');
  });

  it('freezes canonical event names and this phase status names exactly', () => {
    expect([...CANONICAL_AUDIT_EVENTS]).toEqual(canonicalEvents);
    expect([...CANONICAL_AUDIT_STATUSES]).toEqual(canonicalStatuses);
    expect(CANONICAL_AUDIT_STATUSES).not.toContain('ALREADY_EXISTS');
    expect(CANONICAL_AUDIT_STATUSES).not.toContain('UNAUTHENTICATED');
  });

  it('builds a canonical event from caller-provided ts, trace, and span without regeneration', () => {
    const event = buildAuditEvent(
      baseInput({
        durationMs: 42,
        entity: { type: 'report', id: '2026-07-20' },
        tags: ['daily_report', 'read'],
      }),
    );

    expect(event).toEqual({
      ts: '2026-07-21T08:30:00.000Z',
      agent_id: 'mt-agent',
      trace_id: 'trace-1',
      span_id: 'span-1',
      event: 'tool.end',
      tool_name: 'publicTraffic.latestSummary',
      status: 'OK',
      result_summary: 'latest summary ready',
      parent_span_id: 'agent-span-1',
      duration_ms: 42,
      channel: 'sdk',
      user_id: expect.stringMatching(/^usr_[a-f0-9]{32}$/),
      entity: { type: 'report', id: '2026-07-20' },
      tags: ['daily_report', 'read'],
    });
  });

  it('captures AuditContext facts in memory without leaking raw actor or channel ids into canonical payloads', () => {
    const context = buildAuditContext({
      source: 'feishu',
      actorAvailable: true,
      rawActorId: 'ou_actor_secret',
      channel: 'http',
      rawChannelId: 'oc_channel_secret',
      messageId: 'om_message_secret',
      requestRef: 'request-2',
      clarificationRef: 'clarify-2',
      runId: 'run-2',
      decisionId: 'decision-2',
      traceId: 'trace-inherited',
      requestStartedAt: '2026-07-21T08:29:00.000Z',
      parentSpanId: 'parent-span',
    });
    const event = buildAuditEvent(baseInput({ context, traceId: 'trace-inherited' }));
    const serialized = JSON.stringify(event);

    expect(context).toMatchObject({
      source: 'feishu',
      actorAvailable: true,
      rawActorId: 'ou_actor_secret',
      rawChannelId: 'oc_channel_secret',
      messageId: 'om_message_secret',
      requestRef: 'request-2',
      clarificationRef: 'clarify-2',
      runId: 'run-2',
      decisionId: 'decision-2',
      traceId: 'trace-inherited',
      requestStartedAt: '2026-07-21T08:29:00.000Z',
      parentSpanId: 'parent-span',
    });
    expect(serialized).not.toContain('ou_actor_secret');
    expect(serialized).not.toContain('oc_channel_secret');
    expect(serialized).not.toContain('om_message_secret');
  });

  it('rejects invalid core fields and forbidden undocumented top-level input keys', () => {
    const invalidInputs: Array<Partial<AuditEventInput>> = [
      { ts: 'not-a-date' },
      { agentId: 'mt/agent' },
      { traceId: ' ' },
      { spanId: '' },
      { toolName: ' ' },
      { durationMs: -1 },
      { tags: ['safe', '../path'] },
    ];

    for (const overrides of invalidInputs) {
      expect(() => buildAuditEvent(baseInput(overrides))).toThrow(/audit event/i);
    }

    const inputWithInvalidEvent = Object.assign({}, baseInput(), { event: 'tool.success' });
    const inputWithInvalidStatus = Object.assign({}, baseInput(), { status: 'success' });
    expect(() => Reflect.apply(buildAuditEvent, undefined, [inputWithInvalidEvent])).toThrow(/audit event/i);
    expect(() => Reflect.apply(buildAuditEvent, undefined, [inputWithInvalidStatus])).toThrow(/audit event/i);
    expect(() => buildAuditEvent(Object.assign(baseInput(), { agentId: 'ou_raw' }))).toThrow(/agent_id/i);
    expect(() => buildAuditEvent(Object.assign(baseInput(), { channel: '../channel' }))).toThrow(/channel/i);
    expect(() => buildAuditEvent(Object.assign(baseInput(), { traceId: 'ou_raw' }))).toThrow(/trace/i);
    expect(() => buildAuditEvent(Object.assign(baseInput(), { spanId: 'oc_raw' }))).toThrow(/span/i);
    expect(() => buildAuditEvent(Object.assign(baseInput(), { toolName: 'om_raw' }))).toThrow(/tool/i);
    expect(() => buildAuditEvent(Object.assign(baseInput(), { tags: ['ou_raw'] }))).toThrow(/tags/i);

    const validContextInput = {
      source: 'feishu' as const,
      actorAvailable: true,
      rawActorId: 'ou_actor',
      channel: 'sdk' as const,
      channelType: 'direct' as const,
      traceId: 'trace-ctx',
      requestStartedAt: '2026-07-21T08:00:00.000Z',
    };
    const contextWithInvalidChannelType = Object.assign({}, validContextInput, { channelType: 'unsafe' });
    expect(() => Reflect.apply(buildAuditContext, undefined, [contextWithInvalidChannelType])).toThrow(/channelType/i);

    const extraInputs = [
      { product_id: '761' },
      { arguments: { token: 'secret' } },
      { filePath: 'C:/secret/report.json' },
      { feishuOpenId: 'ou_raw' },
      { recipientId: 'oc_raw' },
      { confirmationKey: 'confirm-secret' },
      { Authorization: 'Bearer secret' },
      { response: { data: 'full' } },
    ];

    for (const extraInput of extraInputs) {
      expect(() => buildAuditEvent(Object.assign(baseInput(), extraInput))).toThrow(/unknown|forbidden/i);
    }
  });

  it('requires context trace to match the caller trace', () => {
    expect(() =>
      buildAuditEvent(
        baseInput({
          traceId: 'trace-a',
          context: buildAuditContext({
            source: 'scheduler',
            actorAvailable: false,
            traceId: 'trace-b',
            requestStartedAt: '2026-07-21T08:00:00.000Z',
          }),
        }),
      ),
    ).toThrow(/trace/i);
  });

  it('redacts summaries and error messages to compact 200 character safe text', () => {
    const event = buildAuditEvent(
      baseInput({
        resultSummary: `Authorization: Bearer super-secret token=abc password=pw secret=sauce open_id=ou_open union_id=on_union user_id=ou_user chat_id=oc_chat message_id=om_msg recipient_id=oc_recipient confirmationKey=confirm-secret <html><body>report</body></html> "C:/Users/me/My Reports/report.json" C:\\Users\\me\\My Reports\\report.json /tmp/My Reports/report.json file:///tmp/My%20Reports/report.json ${'x'.repeat(260)}`,
        error: new Error(
          'stack should not survive token=abc cookie=session password=pw api_key=key Authorization Bearer secret ou_error_actor oc_error_chat om_error_message recipient=oc_recipient confirmation_key=confirm-secret path /tmp/My Reports/report.json <div>bad</div>',
        ),
      }),
    );
    const serialized = JSON.stringify(event);

    expect(event.result_summary.length).toBeLessThanOrEqual(200);
    expect(event.error?.message.length).toBeLessThanOrEqual(200);
    expect(Object.keys(event.error ?? {})).toEqual(['message']);
    expect(serialized).toContain('[redacted]');
    expect(serialized).not.toContain('super-secret');
    expect(serialized).not.toContain('token=abc');
    expect(serialized).not.toContain('password=pw');
    expect(serialized).not.toContain('secret=sauce');
    expect(serialized).not.toContain('ou_open');
    expect(serialized).not.toContain('on_union');
    expect(serialized).not.toContain('ou_user');
    expect(serialized).not.toContain('oc_chat');
    expect(serialized).not.toContain('om_msg');
    expect(serialized).not.toContain('oc_recipient');
    expect(serialized).not.toContain('confirm-secret');
    expect(serialized).not.toContain('ou_error_actor');
    expect(serialized).not.toContain('oc_error_chat');
    expect(serialized).not.toContain('om_error_message');
    expect(serialized).not.toContain('<html>');
    expect(serialized).not.toContain('C:/Users/me/My Reports/report.json');
    expect(serialized).not.toContain('C:\\Users\\me\\My Reports\\report.json');
    expect(serialized).not.toContain('/tmp/My Reports/report.json');
    expect(serialized).not.toContain('file:///tmp/My%20Reports/report.json');
    expect(serialized).not.toContain('Reports/report.json');
    expect(serialized).not.toContain('stack');
  });

  it('rejects summaries that become blank after redaction and compaction', () => {
    expect(() => buildAuditEvent(baseInput({ resultSummary: '   <div> </div>   ' }))).toThrow(/result_summary/i);
  });

  it('pseudonymizes Feishu users by source namespace and allows autonomous events to omit user_id', () => {
    const sdkEvent = buildAuditEvent(baseInput({ context: buildAuditContext({ source: 'feishu', actorAvailable: true, rawActorId: 'ou_same', channel: 'sdk', traceId: 'trace-1', requestStartedAt: '2026-07-21T08:00:00.000Z' }) }));
    const httpEvent = buildAuditEvent(baseInput({ context: buildAuditContext({ source: 'feishu', actorAvailable: true, rawActorId: 'ou_same', channel: 'http', traceId: 'trace-1', requestStartedAt: '2026-07-21T08:00:00.000Z' }) }));
    const otherEvent = buildAuditEvent(baseInput({ context: buildAuditContext({ source: 'feishu', actorAvailable: true, rawActorId: 'ou_other', channel: 'sdk', traceId: 'trace-1', requestStartedAt: '2026-07-21T08:00:00.000Z' }) }));
    const autonomousEvent = buildAuditEvent(
      baseInput({
        traceId: 'trace-2',
        context: buildAuditContext({
          source: 'scheduler',
          actorAvailable: false,
          channel: 'cli',
          traceId: 'trace-2',
          requestStartedAt: '2026-07-21T08:00:00.000Z',
        }),
      }),
    );

    expect(sdkEvent.user_id).toBe(httpEvent.user_id);
    expect(pseudonymizeAuditUserId(buildAuditContext({ source: 'feishu', actorAvailable: true, rawActorId: 'ou_same', channel: 'sdk', traceId: 'trace-1', requestStartedAt: '2026-07-21T08:00:00.000Z' }))).toBe(sdkEvent.user_id);
    expect(sdkEvent.user_id).not.toBe(otherEvent.user_id);
    expect(JSON.stringify(sdkEvent)).not.toContain('ou_same');
    expect(autonomousEvent.user_id).toBeUndefined();
    expect(() =>
      buildAuditEvent(
        baseInput({
          traceId: 'trace-3',
          context: buildAuditContext({
            source: 'feishu',
            actorAvailable: true,
            channel: 'sdk',
            traceId: 'trace-3',
            requestStartedAt: '2026-07-21T08:00:00.000Z',
          }),
        }),
      ),
    ).toThrow(/actor/i);
  });

  it('allows only stable report entities and omits entity when none is supplied', () => {
    expect(buildAuditEvent(baseInput({ entity: { type: 'report', id: '2026-07-20' } })).entity).toEqual({
      type: 'report',
      id: '2026-07-20',
    });
    expect(buildAuditEvent(baseInput({ entity: { type: 'report', id: '550e8400-e29b-41d4-a716-446655440000' } })).entity).toEqual({
      type: 'report',
      id: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(buildAuditEvent(baseInput()).entity).toBeUndefined();

    const inputWithInvalidEntityType = Object.assign({}, baseInput(), { entity: { type: 'product', id: '761' } });
    expect(() => Reflect.apply(buildAuditEvent, undefined, [inputWithInvalidEntityType])).toThrow(/entity/i);
    expect(() => buildAuditEvent(baseInput({ entity: { type: 'report', id: '761' } }))).toThrow(/entity/i);
    expect(() => buildAuditEvent(baseInput({ entity: { type: 'report', id: 'report' } }))).toThrow(/entity/i);
    expect(() => buildAuditEvent(baseInput({ entity: { type: 'report', id: 'ou_actor_123' } }))).toThrow(/entity/i);
    expect(() => buildAuditEvent(baseInput({ entity: { type: 'report', id: '../2026-07-20' } }))).toThrow(/entity/i);
    expect(() => buildAuditEvent(baseInput({ entity: { type: 'report', id: 'C:/output/report.json' } }))).toThrow(/entity/i);
  });

  it('serializes validated events once and rejects final UTF-8 payloads over 64 KiB without truncating JSON', () => {
    const payload = serializeAuditEvent(buildAuditEvent(baseInput()));
    expect(JSON.parse(payload)).toMatchObject({ trace_id: 'trace-1', span_id: 'span-1' });

    const event = buildAuditEvent(baseInput());
    const outputWithExtraTopLevelKey = Object.assign({}, event, { product_id: '761' });
    const outputWithExtraErrorKey = Object.assign({}, event, { error: { message: 'safe', stack: 'raw stack' } });
    const outputWithExtraEntityKey = Object.assign({}, event, {
      entity: { type: 'report', id: '2026-07-20', product_id: '761' },
    });
    const outputWithInvalidStatus = Object.assign({}, event, { status: 'success' });
    const outputWithUnsafeSummary = Object.assign({}, event, { result_summary: 'token=secret' });
    const outputWithUnsafeError = Object.assign({}, event, {
      error: { message: 'token=secret ou_raw C:/Users/me/My Reports/report.json' },
    });
    const outputWithRawUser = Object.assign({}, event, { user_id: 'ou_raw' });
    const outputWithRawChannel = Object.assign({}, event, { channel: 'oc_raw' });
    const outputWithRawTag = Object.assign({}, event, { tags: ['ou_raw'] });
    const outputWithWhitespaceTrace = Object.assign({}, event, { trace_id: ' trace-1 ' });

    expect(() => serializeAuditEvent(outputWithExtraTopLevelKey)).toThrow(/output|key/i);
    expect(() => serializeAuditEvent(outputWithExtraErrorKey)).toThrow(/error/i);
    expect(() => serializeAuditEvent(outputWithExtraEntityKey)).toThrow(/entity/i);
    expect(() => serializeAuditEvent(outputWithInvalidStatus)).toThrow(/status/i);
    expect(() => serializeAuditEvent(outputWithUnsafeSummary)).toThrow(/result_summary/i);
    expect(() => serializeAuditEvent(outputWithUnsafeError)).toThrow(/error/i);
    expect(() => serializeAuditEvent(outputWithRawUser)).toThrow(/user_id/i);
    expect(() => serializeAuditEvent(outputWithRawChannel)).toThrow(/channel/i);
    expect(() => serializeAuditEvent(outputWithRawTag)).toThrow(/tags/i);
    expect(() => serializeAuditEvent(outputWithWhitespaceTrace)).toThrow(/trace_id/i);

    const hugeTags = Array.from({ length: 9000 }, (_, index) => `tag_${index.toString().padStart(4, '0')}`);
    expect(() => serializeAuditEvent(buildAuditEvent(baseInput({ tags: hugeTags })))).toThrow(/64 KiB/i);
  });
});
