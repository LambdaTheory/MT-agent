import { describe, expect, it } from 'vitest';
import { SELECTED_AUDIT_TOOL_NAMES, type SelectedAuditToolName } from '../src/audit/config.js';
import {
  classifySelectedToolException,
  mapSelectedToolDomainOutcome,
  type SelectedToolDomainFacts,
} from '../src/audit/domainMapper.js';

function expectNoLeak(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain('C:/output/private/report.json');
  expect(serialized).not.toContain('/tmp/private/report.json');
  expect(serialized).not.toContain('token=secret');
  expect(serialized).not.toContain('ou_user_1');
  expect(serialized).not.toContain('raw failure reason');
  expect(serialized).not.toContain('report path');
}

describe('selected-tool audit domain mapper', () => {
  it('exports a closed selected audit tool name union from config', () => {
    const selectedTool: SelectedAuditToolName = 'publicTraffic.reportQuery';

    expect(selectedTool).toBe('publicTraffic.reportQuery');
    expect(SELECTED_AUDIT_TOOL_NAMES).toHaveLength(11);
  });

  it.each([
    ['publicTraffic.latestSummary'],
    ['publicTraffic.conversionSummary'],
    ['publicTraffic.reportQuery'],
    ['publicTraffic.problemProducts'],
    ['publicTraffic.orderSummary'],
  ] as const)('maps report query success and missing context for %s', (toolName) => {
    expect(
      mapSelectedToolDomainOutcome({
        toolName,
        kind: 'report_success',
        reportDate: '2026-07-21',
      }),
    ).toEqual({
      status: 'OK',
      resultSummary: 'report_context_available',
      entity: { type: 'report', id: '2026-07-21' },
      tags: ['selected_tool', 'report_context', 'report_found'],
    });

    expect(
      mapSelectedToolDomainOutcome({
        toolName,
        kind: 'report_missing',
        reportDate: '2026-07-21',
      }),
    ).toEqual({
      status: 'NOT_FOUND',
      resultSummary: 'report_context_missing',
      entity: { type: 'report', id: '2026-07-21' },
      tags: ['selected_tool', 'report_context', 'report_missing'],
    });
  });

  it('maps product query missing report context with optional validated report entity', () => {
    expect(
      mapSelectedToolDomainOutcome({
        toolName: 'productLink.query',
        kind: 'report_missing',
        reportDate: '2026-07-22',
      }),
    ).toEqual({
      status: 'NOT_FOUND',
      resultSummary: 'report_context_missing',
      entity: { type: 'report', id: '2026-07-22' },
      tags: ['selected_tool', 'report_context', 'report_missing'],
    });

    expect(
      mapSelectedToolDomainOutcome({
        toolName: 'productLink.query',
        kind: 'report_missing',
      }),
    ).toEqual({
      status: 'NOT_FOUND',
      resultSummary: 'report_context_missing',
      tags: ['selected_tool', 'report_context', 'report_missing'],
    });
  });

  it('maps executor guard outcomes to canonical statuses without leaking reasons', () => {
    const cases: Array<[SelectedToolDomainFacts, string]> = [
      [
        { toolName: 'publicTraffic.reportQuery', kind: 'invalid_argument', argument: 'query_type' },
        'INVALID_ARGUMENT',
      ],
      [
        { toolName: 'publicTraffic.runReport', kind: 'already_running' },
        'FAILED_PRECONDITION',
      ],
      [
        { toolName: 'publicTraffic.resendLatestReport', kind: 'delivery', deliveryOutcome: 'sent', reportDate: '2026-07-21' },
        'OK',
      ],
      [
        { toolName: 'publicTraffic.pushLatestReportToGroup', kind: 'delivery', deliveryOutcome: 'provider_error', reportDate: '2026-07-21' },
        'UNAVAILABLE',
      ],
      [
        { toolName: 'publicTraffic.runReport', kind: 'run_report', firstReportSent: true },
        'OK',
      ],
      [
        { toolName: 'publicTraffic.runReport', kind: 'run_report', firstReportSent: false },
        'UNKNOWN',
      ],
    ];

    for (const [facts, status] of cases) {
      const mapped = mapSelectedToolDomainOutcome(facts);
      expect(mapped.status).toBe(status);
      expect(mapped.tags).toContain('selected_tool');
      if (facts.kind === 'delivery') expect(mapped.entity).toEqual({ type: 'report', id: '2026-07-21' });
      expectNoLeak(mapped);
    }
  });

  it.each([
    ['repaired', 'OK'],
    ['still_missing', 'FAILED_PRECONDITION'],
    ['saved_existing_complete', 'OK'],
    ['saved_already_resent', 'OK'],
    ['saved_historical_without_report', 'NOT_FOUND'],
  ] as const)('maps refresh status %s to %s', (refreshStatus, status) => {
    expect(
      mapSelectedToolDomainOutcome({
        toolName: 'publicTraffic.refreshDashboard',
        kind: 'refresh_dashboard',
        reportDate: '2026-07-21',
        refreshStatus,
      }),
    ).toMatchObject({
      status,
      resultSummary: `refresh_${refreshStatus}`,
      entity: { type: 'report', id: '2026-07-21' },
      tags: ['selected_tool', 'refresh_dashboard', `refresh_${refreshStatus}`],
    });
  });

  it('maps data health from counts and booleans only', () => {
    expect(
      mapSelectedToolDomainOutcome({
        toolName: 'system.dataHealth',
        kind: 'data_health',
        reportDate: '2026-07-21',
        reportContextAvailable: true,
        qualityIssueCount: 0,
        staleSourceCount: 0,
      }),
    ).toEqual({
      status: 'OK',
      resultSummary: 'data_health_clean issues=0 stale_sources=0',
      entity: { type: 'report', id: '2026-07-21' },
      tags: ['selected_tool', 'data_health', 'health_clean'],
    });

    expect(
      mapSelectedToolDomainOutcome({
        toolName: 'system.dataHealth',
        kind: 'data_health',
        reportDate: '2026-07-21',
        reportContextAvailable: false,
        qualityIssueCount: 2,
        staleSourceCount: 1,
      }),
    ).toEqual({
      status: 'FAILED_PRECONDITION',
      resultSummary: 'data_health_blocked issues=2 stale_sources=1',
      entity: { type: 'report', id: '2026-07-21' },
      tags: ['selected_tool', 'data_health', 'health_blocked', 'report_missing'],
    });
  });

  it('maps product query by closed query type and counts', () => {
    expect(
      mapSelectedToolDomainOutcome({
        toolName: 'productLink.query',
        kind: 'product_query',
        reportDate: '2026-07-21',
        queryType: 'product_detail',
        matchCount: 0,
      }),
    ).toEqual({
      status: 'NOT_FOUND',
      resultSummary: 'product_query product_detail matches=0',
      entity: { type: 'report', id: '2026-07-21' },
      tags: ['selected_tool', 'product_query', 'query_product_detail', 'no_match'],
    });

    expect(
      mapSelectedToolDomainOutcome({
        toolName: 'productLink.query',
        kind: 'product_query',
        reportDate: '2026-07-21',
        queryType: 'source_coverage',
        matchCount: 0,
      }),
    ).toMatchObject({
      status: 'OK',
      resultSummary: 'product_query source_coverage matches=0',
      entity: { type: 'report', id: '2026-07-21' },
    });
  });

  it('validates report dates before creating strict report entities', () => {
    expect(() =>
      mapSelectedToolDomainOutcome({
        toolName: 'productLink.query',
        kind: 'product_query',
        reportDate: '2026-02-30',
        queryType: 'product_detail',
        matchCount: 1,
      }),
    ).toThrow(/report date/i);
  });

  it('classifies exceptions into stable canonical categories without leaking messages', () => {
    const abortError = new Error('AbortError: C:/output/private/report.json token=secret');
    abortError.name = 'AbortError';

    const networkError = Object.assign(new Error('connect ECONNRESET /tmp/private/report.json'), { code: 'ECONNRESET' });
    const validationError = new Error('date must be YYYY-MM-DD C:/output/private/report.json');
    const internalError = new Error('raw failure reason ou_user_1 token=secret');

    const mapped = [
      classifySelectedToolException(abortError),
      classifySelectedToolException(networkError),
      classifySelectedToolException(validationError),
      classifySelectedToolException(internalError),
    ];

    expect(mapped).toEqual([
      { status: 'DEADLINE_EXCEEDED', resultSummary: 'exception_deadline', tags: ['selected_tool', 'exception', 'exception_deadline'] },
      { status: 'UNAVAILABLE', resultSummary: 'exception_unavailable', tags: ['selected_tool', 'exception', 'exception_unavailable'] },
      { status: 'INVALID_ARGUMENT', resultSummary: 'exception_invalid_argument', tags: ['selected_tool', 'exception', 'exception_invalid_argument'] },
      { status: 'INTERNAL', resultSummary: 'exception_internal', tags: ['selected_tool', 'exception', 'exception_internal'] },
    ]);
    expectNoLeak(mapped);
  });

  it.each([
    'date must be YYYY-MM-DD C:/output/private/report.json token=secret',
    'problemType must be low_exposure, weak_conversion, high_potential, new_product_pool, or recommended_action',
    'sendTo must be personal, group, or both',
    'planRef is required',
    'metrics is required when aggregation is specified',
  ])('classifies executor validation message as invalid argument without copying: %s', (message) => {
    const mapped = classifySelectedToolException(new Error(message));

    expect(mapped).toEqual({
      status: 'INVALID_ARGUMENT',
      resultSummary: 'exception_invalid_argument',
      tags: ['selected_tool', 'exception', 'exception_invalid_argument'],
    });
    expectNoLeak(mapped);
  });

  it('uses nested cause codes for fetch network and timeout errors without treating every TypeError as invalid', () => {
    const fetchNetworkError = new TypeError('fetch failed token=secret', {
      cause: Object.assign(new Error('connect ECONNRESET /tmp/private/report.json'), { code: 'ECONNRESET' }),
    });
    const fetchTimeoutError = new TypeError('fetch failed C:/output/private/report.json', {
      cause: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }),
    });
    const plainTypeError = new TypeError('fetch failed raw failure reason ou_user_1');

    const mapped = [
      classifySelectedToolException(fetchNetworkError),
      classifySelectedToolException(fetchTimeoutError),
      classifySelectedToolException(plainTypeError),
    ];

    expect(mapped).toEqual([
      { status: 'UNAVAILABLE', resultSummary: 'exception_unavailable', tags: ['selected_tool', 'exception', 'exception_unavailable'] },
      { status: 'DEADLINE_EXCEEDED', resultSummary: 'exception_deadline', tags: ['selected_tool', 'exception', 'exception_deadline'] },
      { status: 'INTERNAL', resultSummary: 'exception_internal', tags: ['selected_tool', 'exception', 'exception_internal'] },
    ]);
    expectNoLeak(mapped);
  });
});
