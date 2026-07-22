import type { AuditConfig } from './types.js';

export const AUDIT_RETRY_MAX_BATCH_LIMIT = 500;

export const SELECTED_AUDIT_TOOL_NAMES = Object.freeze([
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
] as const);

export type SelectedAuditToolName = (typeof SELECTED_AUDIT_TOOL_NAMES)[number];

const selectedAuditTools = new Set<string>(SELECTED_AUDIT_TOOL_NAMES);
const agentIdPattern = /^[A-Za-z0-9._-]+$/;

type AuditEnv = Readonly<Record<string, string | undefined>>;

export function isSelectedAuditTool(toolName: string): boolean {
  return selectedAuditTools.has(toolName);
}

function auditConfigError(name: string): Error {
  return new Error(`Invalid audit config: ${name}`);
}

function readEnv(env: AuditEnv, name: string): string | undefined {
  return env[name];
}

function parsePositiveInteger(value: string | undefined, name: string, fallback: number): number {
  const raw = value?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw auditConfigError(name);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw auditConfigError(name);
  return parsed;
}

function parseBoolean(value: string | undefined, name: string, fallback: boolean): boolean {
  const raw = value?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw auditConfigError(name);
}

function validateAgentId(value: string): string {
  const agentId = value.trim();
  if (!agentIdPattern.test(agentId) || agentId === '.' || agentId === '..') {
    throw auditConfigError('MT_AGENT_AUDIT_AGENT_ID');
  }
  return agentId;
}

function parseIngestUrl(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;

  let url: URL;
  try {
    url = new URL(raw);
  } catch (error) {
    throw auditConfigError('AUDIT_INGEST_URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw auditConfigError('AUDIT_INGEST_URL');
  }
  if (url.pathname !== '/v1/ingest' || url.username || url.password || url.search || url.hash) {
    throw auditConfigError('AUDIT_INGEST_URL');
  }
  return url.toString();
}

function parseRetryMaxBatch(value: string | undefined): number {
  const retryMaxBatch = parsePositiveInteger(value, 'AUDIT_RETRY_MAX_BATCH', 50);
  if (retryMaxBatch > AUDIT_RETRY_MAX_BATCH_LIMIT) {
    throw auditConfigError('AUDIT_RETRY_MAX_BATCH');
  }
  return retryMaxBatch;
}

function joinAuditDir(outputDir: string): string {
  return `${outputDir.replace(/[\\/]+$/, '')}/audit`;
}

function isIsolatedAuditDir(value: string): boolean {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  const segments = normalized.split('/').filter(Boolean);
  const lastSegment = segments.at(-1);
  return lastSegment !== undefined && /audit/i.test(lastSegment) && normalized !== '.' && normalized !== '..';
}

function parseLogDir(env: AuditEnv): string {
  const explicitValue = readEnv(env, 'MT_AGENT_AUDIT_LOG_DIR');
  if (explicitValue !== undefined && explicitValue.trim() === '') {
    throw auditConfigError('MT_AGENT_AUDIT_LOG_DIR');
  }
  const explicit = explicitValue?.trim();
  const logDir = explicit || joinAuditDir(readEnv(env, 'MT_AGENT_OUTPUT_DIR')?.trim() || 'output');
  if (!logDir || !isIsolatedAuditDir(logDir)) {
    throw auditConfigError('MT_AGENT_AUDIT_LOG_DIR');
  }
  return logDir.replace(/\\/g, '/').replace(/\/+$/, '');
}

export function parseAuditConfig(env: AuditEnv): AuditConfig {
  const ingestUrl = parseIngestUrl(readEnv(env, 'AUDIT_INGEST_URL'));
  const config: AuditConfig = {
    agentId: validateAgentId(readEnv(env, 'MT_AGENT_AUDIT_AGENT_ID') ?? 'mt-agent'),
    ...(ingestUrl ? { ingestUrl } : {}),
    remoteEnabled: ingestUrl !== undefined,
    localEnabled: true,
    ingestTimeoutMs: parsePositiveInteger(readEnv(env, 'AUDIT_INGEST_TIMEOUT_MS'), 'AUDIT_INGEST_TIMEOUT_MS', 1500),
    retryEnabled: parseBoolean(readEnv(env, 'AUDIT_RETRY_ENABLED'), 'AUDIT_RETRY_ENABLED', true),
    retryMaxBatch: parseRetryMaxBatch(readEnv(env, 'AUDIT_RETRY_MAX_BATCH')),
    logDir: parseLogDir(env),
    flushTimeoutMs: parsePositiveInteger(readEnv(env, 'AUDIT_FLUSH_TIMEOUT_MS'), 'AUDIT_FLUSH_TIMEOUT_MS', 1000),
  };
  return Object.freeze(config);
}
