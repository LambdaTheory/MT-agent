import { createHash } from 'node:crypto';
import {
  CANONICAL_AUDIT_EVENTS,
  CANONICAL_AUDIT_STATUSES,
  type AuditContext,
  type AuditEntity,
  type AuditEventInput,
  type AuditChannel,
  type AuditChannelType,
  type CanonicalAuditEvent,
  type CanonicalAuditEventName,
  type CanonicalAuditStatus,
} from './types.js';

export { CANONICAL_AUDIT_EVENTS, CANONICAL_AUDIT_STATUSES } from './types.js';
export type { CanonicalAuditEventName, CanonicalAuditStatus } from './types.js';

export const AUDIT_EVENT_MAX_BYTES = 64 * 1024;

const canonicalEventSet = new Set<string>(CANONICAL_AUDIT_EVENTS);
const canonicalStatusSet = new Set<string>(CANONICAL_AUDIT_STATUSES);
const auditChannelSet = new Set<string>(['feishu', 'sdk', 'http', 'cli', 'api', 'agent', 'scheduler', 'unknown']);
const auditChannelTypeSet = new Set<string>(['direct', 'group', 'unknown']);
const safeIdentifierPattern = /^[A-Za-z0-9._-]+$/;
const rawFeishuIdPattern = /\b(?:ou|oc|om|on)_[A-Za-z0-9._-]+\b/;
const pseudonymizedUserIdPattern = /^usr_[a-f0-9]{32}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedInputKeys = new Set([
  'ts',
  'agentId',
  'traceId',
  'spanId',
  'event',
  'toolName',
  'status',
  'resultSummary',
  'context',
  'parentSpanId',
  'durationMs',
  'channel',
  'entity',
  'error',
  'tags',
]);
const allowedOutputKeys = new Set([
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
]);

function auditEventError(name: string): Error {
  return new Error(`Invalid audit event: ${name}`);
}

function assertNonBlank(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw auditEventError(name);
  return trimmed;
}

function validateAgentId(value: string): string {
  const agentId = assertNonBlank(value, 'agent_id');
  if (!safeIdentifierPattern.test(agentId) || agentId === '.' || agentId === '..' || rawFeishuIdPattern.test(agentId)) {
    throw auditEventError('agent_id');
  }
  return agentId;
}

function validateIsoTimestamp(value: string, name: string): string {
  const trimmed = assertNonBlank(value, name);
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== trimmed) {
    throw auditEventError(name);
  }
  return trimmed;
}

function validateCanonicalEvent(value: string): CanonicalAuditEventName {
  if (!canonicalEventSet.has(value)) throw auditEventError('event');
  return value as CanonicalAuditEventName;
}

function validateCanonicalStatus(value: string): CanonicalAuditStatus {
  if (!canonicalStatusSet.has(value)) throw auditEventError('status');
  return value as CanonicalAuditStatus;
}

function validateSafeIdentifier(value: string, name: string): string {
  const trimmed = assertNonBlank(value, name);
  if (!safeIdentifierPattern.test(trimmed) || trimmed === '.' || trimmed === '..' || rawFeishuIdPattern.test(trimmed)) {
    throw auditEventError(name);
  }
  return trimmed;
}

function validateChannel(value: string | undefined): AuditChannel | undefined {
  if (value === undefined) return undefined;
  const trimmed = assertNonBlank(value, 'channel');
  if (!auditChannelSet.has(trimmed)) throw auditEventError('channel');
  return trimmed as AuditChannel;
}

function validateChannelType(value: string | undefined): AuditChannelType | undefined {
  if (value === undefined) return undefined;
  const trimmed = assertNonBlank(value, 'channelType');
  if (!auditChannelTypeSet.has(trimmed)) throw auditEventError('channelType');
  return trimmed as AuditChannelType;
}

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function redactText(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/"[A-Za-z]:[\\/][^"\r\n]+"/g, '[redacted-path]')
    .replace(/'[A-Za-z]:[\\/][^'\r\n]+'/g, '[redacted-path]')
    .replace(/[A-Za-z]:[\\/][^,;}\r\n]+/g, '[redacted-path]')
    .replace(/file:\/\/\/[^\s,;}]+(?:%20[^\s,;}]+)*/gi, '[redacted-path]')
    .replace(/(?:^|\s)\/[^,;}\r\n]+/g, ' [redacted-path]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(
      /\b(authorization|api[_-]?key|token|cookie|password|secret|open_id|union_id|user_id|chat_id|message_id|recipient|recipient_id|confirmationKey|confirmation_key)\b\s*[:=]\s*[^\s,;}]+/gi,
      '$1=[redacted]',
    )
    .replace(/\b(?:ou|oc|om|on)_[A-Za-z0-9._-]+\b/g, '[redacted-id]');
}

function summarizeText(value: string): string {
  const redacted = compactText(redactText(value));
  if (!redacted) throw auditEventError('result_summary');
  return redacted.length > 200 ? redacted.slice(0, 200) : redacted;
}

function summarizeError(error: unknown): { message: string } | undefined {
  if (error === undefined) return undefined;
  if (error instanceof Error) return { message: summarizeText(error.message.replace(/stack/gi, '[redacted]')) };
  if (typeof error === 'string') return { message: summarizeText(error) };
  return { message: summarizeText('Non-error audit failure') };
}

function isStrictBusinessDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearValue, monthValue, dayValue] = match;
  if (yearValue === undefined || monthValue === undefined || dayValue === undefined) return false;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validateEntity(entity: AuditEntity | undefined): AuditEntity | undefined {
  if (entity === undefined) return undefined;
  if (entity.type !== 'report') throw auditEventError('entity');
  if (!isStrictBusinessDate(entity.id) && !uuidPattern.test(entity.id)) {
    throw auditEventError('entity');
  }
  if (entity.id.includes('/') || entity.id.includes('\\') || entity.id.includes(':') || entity.id === '.' || entity.id === '..') {
    throw auditEventError('entity');
  }
  return { type: 'report', id: entity.id };
}

function validateTags(tags: string[] | undefined): string[] | undefined {
  if (tags === undefined) return undefined;
  return tags.map((tag) => validateSafeIdentifier(tag, 'tags'));
}

function validateDuration(durationMs: number | undefined): number | undefined {
  if (durationMs === undefined) return undefined;
  if (!Number.isFinite(durationMs) || durationMs < 0) throw auditEventError('duration_ms');
  return durationMs;
}

function validateInputKeyClosure(input: AuditEventInput): void {
  for (const key of Object.keys(input)) {
    if (!allowedInputKeys.has(key)) throw new Error(`Unknown audit event input key: ${key}`);
  }
}

export function pseudonymizeAuditUserId(context: AuditContext | undefined): string | undefined {
  if (context === undefined) return undefined;
  if (context.userIdOverride !== undefined) {
    if (!pseudonymizedUserIdPattern.test(context.userIdOverride)) throw auditEventError('user_id');
    return context.userIdOverride;
  }
  if (context.source === 'feishu' && context.actorAvailable && !context.rawActorId?.trim()) {
    throw auditEventError('actor');
  }
  if (!context.rawActorId?.trim()) return undefined;
  const digest = createHash('sha256').update(`${context.source}:${context.rawActorId.trim()}`).digest('hex').slice(0, 32);
  return `usr_${digest}`;
}

export function buildAuditContext(context: AuditContext): AuditContext {
  validateIsoTimestamp(context.requestStartedAt, 'requestStartedAt');
  validateSafeIdentifier(context.traceId, 'traceId');
  if (context.parentSpanId !== undefined) validateSafeIdentifier(context.parentSpanId, 'parentSpanId');
  if (context.userIdOverride !== undefined && !pseudonymizedUserIdPattern.test(context.userIdOverride)) throw auditEventError('user_id');
  const channel = validateChannel(context.channel);
  const channelType = validateChannelType(context.channelType);
  return Object.freeze({
    ...context,
    ...(channel !== undefined ? { channel } : {}),
    ...(channelType !== undefined ? { channelType } : {}),
  });
}

export function buildAuditEvent(input: AuditEventInput): CanonicalAuditEvent {
  validateInputKeyClosure(input);

  const contextChannel = input.context?.channel;
  const parentSpanId = input.parentSpanId ?? input.context?.parentSpanId;
  const traceId = validateSafeIdentifier(input.traceId, 'trace_id');
  if (input.context !== undefined && traceId !== input.context.traceId) throw auditEventError('trace_id');
  const durationMs = validateDuration(input.durationMs);
  const channel = validateChannel(input.channel ?? contextChannel);
  const userId = pseudonymizeAuditUserId(input.context);
  const entity = validateEntity(input.entity);
  const error = summarizeError(input.error);
  const tags = validateTags(input.tags);
  const event: CanonicalAuditEvent = {
    ts: validateIsoTimestamp(input.ts, 'ts'),
    agent_id: validateAgentId(input.agentId),
    trace_id: traceId,
    span_id: validateSafeIdentifier(input.spanId, 'span_id'),
    event: validateCanonicalEvent(input.event),
    tool_name: validateSafeIdentifier(input.toolName, 'tool_name'),
    status: validateCanonicalStatus(input.status),
    result_summary: summarizeText(input.resultSummary),
    ...(parentSpanId !== undefined ? { parent_span_id: validateSafeIdentifier(parentSpanId, 'parent_span_id') } : {}),
    ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
    ...(channel !== undefined ? { channel } : {}),
    ...(userId !== undefined ? { user_id: userId } : {}),
    ...(entity !== undefined ? { entity } : {}),
    ...(error !== undefined ? { error } : {}),
    ...(tags !== undefined ? { tags } : {}),
  };
  return Object.freeze(event);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireStringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw auditEventError(key);
  return value;
}

function validateOutputKeyClosure(event: CanonicalAuditEvent): void {
  for (const key of Object.keys(event)) {
    if (!allowedOutputKeys.has(key)) throw new Error(`Invalid audit event output key: ${key}`);
  }
  if (event.error !== undefined && Object.keys(event.error).some((key) => key !== 'message')) {
    throw auditEventError('error');
  }
  if (event.entity !== undefined && Object.keys(event.entity).some((key) => key !== 'type' && key !== 'id')) {
    throw auditEventError('entity');
  }
}

function validateSerializableEvent(event: CanonicalAuditEvent): void {
  if (!isRecord(event)) throw auditEventError('event');
  validateOutputKeyClosure(event);
  const ts = requireStringField(event, 'ts');
  const agentId = requireStringField(event, 'agent_id');
  const traceId = requireStringField(event, 'trace_id');
  const spanId = requireStringField(event, 'span_id');
  const eventName = requireStringField(event, 'event');
  const toolName = requireStringField(event, 'tool_name');
  const status = requireStringField(event, 'status');
  const resultSummary = requireStringField(event, 'result_summary');
  if (validateIsoTimestamp(ts, 'ts') !== ts) throw auditEventError('ts');
  if (validateAgentId(agentId) !== agentId) throw auditEventError('agent_id');
  if (validateSafeIdentifier(traceId, 'trace_id') !== traceId) throw auditEventError('trace_id');
  if (validateSafeIdentifier(spanId, 'span_id') !== spanId) throw auditEventError('span_id');
  if (validateCanonicalEvent(eventName) !== eventName) throw auditEventError('event');
  if (validateSafeIdentifier(toolName, 'tool_name') !== toolName) throw auditEventError('tool_name');
  if (validateCanonicalStatus(status) !== status) throw auditEventError('status');
  if (summarizeText(resultSummary) !== resultSummary) throw auditEventError('result_summary');
  if (event.parent_span_id !== undefined && validateSafeIdentifier(event.parent_span_id, 'parent_span_id') !== event.parent_span_id) {
    throw auditEventError('parent_span_id');
  }
  if (event.duration_ms !== undefined) validateDuration(event.duration_ms);
  if (event.channel !== undefined && validateChannel(event.channel) !== event.channel) throw auditEventError('channel');
  if (event.user_id !== undefined && !pseudonymizedUserIdPattern.test(event.user_id)) throw auditEventError('user_id');
  if (event.entity !== undefined) validateEntity(event.entity);
  if (event.error !== undefined && summarizeText(event.error.message) !== event.error.message) throw auditEventError('error');
  if (event.tags !== undefined) {
    const tags = validateTags(event.tags);
    if (tags === undefined || tags.some((tag, index) => tag !== event.tags?.[index])) throw auditEventError('tags');
  }
}

export function serializeAuditEvent(event: CanonicalAuditEvent): string {
  validateSerializableEvent(event);
  const payload = JSON.stringify(event);
  if (Buffer.byteLength(payload, 'utf8') > AUDIT_EVENT_MAX_BYTES) {
    throw new Error('Invalid audit event: exceeds 64 KiB');
  }
  return payload;
}
