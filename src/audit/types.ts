export type AuditSource = 'feishu' | 'agent' | 'api' | 'cli' | 'scheduler' | 'unknown';
export type AuditChannel = 'feishu' | 'sdk' | 'http' | 'cli' | 'api' | 'agent' | 'scheduler' | 'unknown';
export type AuditChannelType = 'direct' | 'group' | 'unknown';

export const CANONICAL_AUDIT_EVENTS = Object.freeze([
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
] as const);

export const CANONICAL_AUDIT_STATUSES = Object.freeze([
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
] as const);

export type CanonicalAuditEventName = (typeof CANONICAL_AUDIT_EVENTS)[number];
export type CanonicalAuditStatus = (typeof CANONICAL_AUDIT_STATUSES)[number];

export interface AuditContext {
  source: AuditSource;
  actorAvailable: boolean;
  rawActorId?: string;
  userIdOverride?: string;
  channel?: AuditChannel;
  channelType?: AuditChannelType;
  rawChannelId?: string;
  messageId?: string;
  requestRef?: string;
  clarificationRef?: string;
  runId?: string;
  decisionId?: string;
  traceId: string;
  requestStartedAt: string;
  parentSpanId?: string;
}

export interface AuditEntity {
  type: 'report';
  id: string;
}

export interface AuditErrorSummary {
  message: string;
}

export interface CanonicalAuditEvent {
  ts: string;
  agent_id: string;
  trace_id: string;
  span_id: string;
  event: CanonicalAuditEventName;
  tool_name: string;
  status: CanonicalAuditStatus;
  result_summary: string;
  parent_span_id?: string;
  duration_ms?: number;
  channel?: AuditChannel;
  user_id?: string;
  entity?: AuditEntity;
  error?: AuditErrorSummary;
  tags?: string[];
}

export interface AuditEventInput {
  ts: string;
  agentId: string;
  traceId: string;
  spanId: string;
  event: CanonicalAuditEventName;
  toolName: string;
  status: CanonicalAuditStatus;
  resultSummary: string;
  context?: AuditContext;
  parentSpanId?: string;
  durationMs?: number;
  channel?: AuditChannel;
  entity?: AuditEntity;
  error?: unknown;
  tags?: string[];
}

export interface AuditConfig {
  agentId: string;
  ingestUrl?: string;
  remoteEnabled: boolean;
  localEnabled: true;
  ingestTimeoutMs: number;
  retryEnabled: boolean;
  retryMaxBatch: number;
  logDir: string;
  flushTimeoutMs: number;
}

export type AuditRetryReason = 'network' | 'timeout' | 'non_2xx' | 'malformed_response' | 'negative_ack';
export type AuditRetryCategory = 'transient' | 'remote';
export type AuditIsolateStatusReason = 'status_400' | 'status_413' | 'status_415';

export type AuditHttpSendResult =
  | { kind: 'accepted'; statusCode: number }
  | { kind: 'retry'; reason: AuditRetryReason; category: AuditRetryCategory; statusCode?: number }
  | { kind: 'isolate'; reason: AuditIsolateStatusReason; statusCode: 400 | 413 | 415 };

export interface RetryItem {
  id: string;
  payload: string;
  payloadSha256: string;
  reason: AuditRetryReason;
  category: AuditRetryCategory;
  attempts: number;
  firstAttemptedAt: string;
  lastAttemptedAt?: string;
}

export type SendResult = AuditHttpSendResult;

export type AuditRecordStage = 'build' | 'serialize' | 'append' | 'send' | 'replay' | 'flush';
export type AuditErrorCategory = 'local' | 'transient' | 'remote';

export type AuditRecordResult =
  | { ok: true; payload: string }
  | { ok: false; stage: Extract<AuditRecordStage, 'build' | 'serialize' | 'append'>; category: 'local' };

export interface AuditErrorNotice {
  stage: AuditRecordStage;
  category: AuditErrorCategory;
}

export interface AuditReplayResult {
  attempted: number;
  accepted: number;
  retry: number;
  isolated: number;
  compacted: number;
  leased: boolean;
  updated: number;
  failed: boolean;
}

export interface AuditToolSpanHandle {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  toolName: string;
  context?: AuditContext;
  startedAt: string;
  startedAtMs: number;
  startRecordResult?: AuditRecordResult;
}

export interface FlushResult {
  ok: boolean;
  flushed: number;
  failed: number;
  timedOut: boolean;
  backgroundPending?: number;
  replayAttempted?: number;
  replayAccepted?: number;
  replayRetried?: number;
  replayIsolated?: number;
  replayUpdated?: number;
  replayCompacted?: number;
  replayFailed?: boolean;
  queuePending?: number;
  queueBadLines?: number;
  queueTruncated?: boolean;
  deliveryIsolated?: number;
  noticeFailures?: number;
}
