import type { SelectedAuditToolName } from './config.js';
import type { AuditEntity, CanonicalAuditStatus } from './types.js';

export type ReportQueryAuditToolName = Extract<
  SelectedAuditToolName,
  | 'publicTraffic.latestSummary'
  | 'publicTraffic.conversionSummary'
  | 'publicTraffic.reportQuery'
  | 'publicTraffic.problemProducts'
  | 'publicTraffic.orderSummary'
>;

export type DeliveryAuditToolName = Extract<
  SelectedAuditToolName,
  'publicTraffic.resendLatestReport' | 'publicTraffic.pushLatestReportToGroup'
>;

export type DeliveryOutcomeCategory = 'sent' | 'provider_error' | 'unknown';

export type ProductQueryType =
  | 'product_detail'
  | 'product_list'
  | 'problem_pool'
  | 'source_coverage'
  | 'order_metrics'
  | 'link_lifecycle';

export type RefreshDashboardStatus =
  | 'repaired'
  | 'still_missing'
  | 'saved_existing_complete'
  | 'saved_already_resent'
  | 'saved_historical_without_report';

export type InvalidArgumentName = 'query_type' | 'date' | 'period' | 'recipient_type' | 'required_argument';

export type SelectedToolDomainFacts =
  | { toolName: ReportQueryAuditToolName; kind: 'report_success'; reportDate: string }
  | { toolName: ReportQueryAuditToolName | DeliveryAuditToolName | 'publicTraffic.runReport' | 'productLink.query'; kind: 'report_missing'; reportDate?: string }
  | { toolName: SelectedAuditToolName; kind: 'invalid_argument'; argument: InvalidArgumentName }
  | { toolName: 'publicTraffic.runReport'; kind: 'already_running' }
  | { toolName: DeliveryAuditToolName; kind: 'delivery'; deliveryOutcome: DeliveryOutcomeCategory; reportDate: string }
  | { toolName: 'publicTraffic.runReport'; kind: 'run_report'; firstReportSent: boolean; reportDate?: string }
  | { toolName: 'publicTraffic.refreshDashboard'; kind: 'refresh_dashboard'; refreshStatus: RefreshDashboardStatus; reportDate: string }
  | { toolName: SelectedAuditToolName; kind: 'unknown_fallback' }
  | {
      toolName: 'system.dataHealth';
      kind: 'data_health';
      reportDate: string;
      reportContextAvailable: boolean;
      qualityIssueCount: number;
      staleSourceCount: number;
    }
  | { toolName: 'productLink.query'; kind: 'product_query'; queryType: ProductQueryType; matchCount: number; reportDate: string };

export interface SelectedToolAuditDomainMapping {
  status: CanonicalAuditStatus;
  resultSummary: string;
  entity?: AuditEntity;
  tags: string[];
}

const networkErrorCodes = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

const deadlineErrorCodes = new Set(['ABORT_ERR', 'ETIMEDOUT', 'ERR_TIMEOUT', 'TIMEOUT']);
const invalidArgumentErrorCodes = new Set(['ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE', 'ERR_MISSING_ARGS']);

function mapping(
  status: CanonicalAuditStatus,
  resultSummary: string,
  tags: string[],
  entity?: AuditEntity,
): SelectedToolAuditDomainMapping {
  return {
    status,
    resultSummary,
    ...(entity !== undefined ? { entity } : {}),
    tags: ['selected_tool', ...tags],
  };
}

function assertSafeCount(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid selected-tool audit fact: ${name}`);
  }
  return value;
}

function isStrictBusinessDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const [, yearValue, monthValue, dayValue] = match;
  if (yearValue === undefined || monthValue === undefined || dayValue === undefined) return false;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function reportEntity(reportDate: string): AuditEntity {
  if (!isStrictBusinessDate(reportDate)) {
    throw new Error('Invalid selected-tool audit fact: report date');
  }
  return { type: 'report', id: reportDate };
}

function optionalReportEntity(reportDate: string | undefined): AuditEntity | undefined {
  return reportDate === undefined ? undefined : reportEntity(reportDate);
}

function refreshStatusMapping(refreshStatus: RefreshDashboardStatus): CanonicalAuditStatus {
  if (refreshStatus === 'still_missing') return 'FAILED_PRECONDITION';
  if (refreshStatus === 'saved_historical_without_report') return 'NOT_FOUND';
  return 'OK';
}

export function mapSelectedToolDomainOutcome(facts: SelectedToolDomainFacts): SelectedToolAuditDomainMapping {
  switch (facts.kind) {
    case 'report_success':
      return mapping('OK', 'report_context_available', ['report_context', 'report_found'], reportEntity(facts.reportDate));
    case 'report_missing':
      return mapping('NOT_FOUND', 'report_context_missing', ['report_context', 'report_missing'], optionalReportEntity(facts.reportDate));
    case 'invalid_argument':
      return mapping('INVALID_ARGUMENT', `invalid_argument_${facts.argument}`, ['invalid_argument', `argument_${facts.argument}`]);
    case 'already_running':
      return mapping('FAILED_PRECONDITION', 'run_report_already_running', ['run_report', 'already_running']);
    case 'delivery': {
      const entity = reportEntity(facts.reportDate);
      if (facts.deliveryOutcome === 'sent') return mapping('OK', 'delivery_sent', ['delivery', 'delivery_sent'], entity);
      if (facts.deliveryOutcome === 'provider_error') return mapping('UNAVAILABLE', 'delivery_provider_error', ['delivery', 'delivery_provider_error'], entity);
      return mapping('UNKNOWN', 'delivery_unknown', ['delivery', 'delivery_unknown'], entity);
    }
    case 'run_report': {
      const entity = facts.reportDate !== undefined ? reportEntity(facts.reportDate) : undefined;
      if (facts.firstReportSent) return mapping('OK', 'run_report_first_report_sent', ['run_report', 'first_report_sent'], entity);
      return mapping('UNKNOWN', 'run_report_first_report_unsent', ['run_report', 'first_report_unsent'], entity);
    }
    case 'refresh_dashboard':
      return mapping(
        refreshStatusMapping(facts.refreshStatus),
        `refresh_${facts.refreshStatus}`,
        ['refresh_dashboard', `refresh_${facts.refreshStatus}`],
        reportEntity(facts.reportDate),
      );
    case 'unknown_fallback':
      return mapping('UNKNOWN', 'selected_tool_outcome_unknown', ['outcome_unknown']);
    case 'data_health': {
      const entity = reportEntity(facts.reportDate);
      const qualityIssueCount = assertSafeCount(facts.qualityIssueCount, 'qualityIssueCount');
      const staleSourceCount = assertSafeCount(facts.staleSourceCount, 'staleSourceCount');
      const resultSummary = facts.reportContextAvailable && qualityIssueCount === 0 && staleSourceCount === 0
        ? 'data_health_clean issues=0 stale_sources=0'
        : `data_health_blocked issues=${qualityIssueCount} stale_sources=${staleSourceCount}`;
      const tags = facts.reportContextAvailable && qualityIssueCount === 0 && staleSourceCount === 0
        ? ['data_health', 'health_clean']
        : ['data_health', 'health_blocked', ...(facts.reportContextAvailable ? [] : ['report_missing'])];
      return mapping(tags.includes('health_clean') ? 'OK' : 'FAILED_PRECONDITION', resultSummary, tags, entity);
    }
    case 'product_query': {
      const entity = reportEntity(facts.reportDate);
      const matchCount = assertSafeCount(facts.matchCount, 'matchCount');
      const hasProductDetailMiss = facts.queryType === 'product_detail' && matchCount === 0;
      return mapping(
        hasProductDetailMiss ? 'NOT_FOUND' : 'OK',
        `product_query ${facts.queryType} matches=${matchCount}`,
        ['product_query', `query_${facts.queryType}`, ...(hasProductDetailMiss ? ['no_match'] : [])],
        entity,
      );
    }
  }
}

function errorName(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined;
}

function errorCause(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !('cause' in error)) return undefined;
  return (error as { cause?: unknown }).cause;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code.toUpperCase() : undefined;
}

function errorCodes(error: unknown): string[] {
  const codes: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    const code = errorCode(current);
    if (code !== undefined) codes.push(code);
    current = errorCause(current);
  }
  return codes;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '';
}

function isDeadlineException(error: unknown): boolean {
  const name = errorName(error);
  return name === 'AbortError' || name === 'TimeoutError' || errorCodes(error).some((code) => deadlineErrorCodes.has(code));
}

function isUnavailableException(error: unknown): boolean {
  return errorCodes(error).some((code) => networkErrorCodes.has(code));
}

function isInvalidArgumentException(error: unknown): boolean {
  if (errorCodes(error).some((code) => invalidArgumentErrorCodes.has(code))) return true;
  return /\b(?:invalid argument|missing required argument|required argument|argument validation)\b/i.test(errorMessage(error))
    || /\b(?:date|problemType|sendTo) must be\b/.test(errorMessage(error))
    || /\b[A-Za-z][A-Za-z0-9_.-]* is required\b/.test(errorMessage(error));
}

export function classifySelectedToolException(error: unknown): SelectedToolAuditDomainMapping {
  if (isDeadlineException(error)) {
    return mapping('DEADLINE_EXCEEDED', 'exception_deadline', ['exception', 'exception_deadline']);
  }
  if (isUnavailableException(error)) {
    return mapping('UNAVAILABLE', 'exception_unavailable', ['exception', 'exception_unavailable']);
  }
  if (isInvalidArgumentException(error)) {
    return mapping('INVALID_ARGUMENT', 'exception_invalid_argument', ['exception', 'exception_invalid_argument']);
  }
  return mapping('INTERNAL', 'exception_internal', ['exception', 'exception_internal']);
}
