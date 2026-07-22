import { describe, expect, it } from 'vitest';
import {
  AUDIT_RETRY_MAX_BATCH_LIMIT,
  SELECTED_AUDIT_TOOL_NAMES,
  isSelectedAuditTool,
  parseAuditConfig,
} from '../src/audit/config.js';

const selectedTools = [
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
];

describe('audit config contract', () => {
  it('freezes defaults from an injected env without reading process.env', () => {
    const config = parseAuditConfig({});

    expect(config).toEqual({
      agentId: 'mt-agent',
      ingestUrl: undefined,
      remoteEnabled: false,
      localEnabled: true,
      ingestTimeoutMs: 1500,
      retryEnabled: true,
      retryMaxBatch: 50,
      logDir: 'output/audit',
      flushTimeoutMs: 1000,
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('parses a complete injected env and keeps blank URL local-only', () => {
    const config = parseAuditConfig({
      MT_AGENT_AUDIT_AGENT_ID: 'mt-agent.prod_1',
      AUDIT_INGEST_URL: '  ',
      AUDIT_INGEST_TIMEOUT_MS: '2500',
      AUDIT_RETRY_ENABLED: 'false',
      AUDIT_RETRY_MAX_BATCH: '7',
      MT_AGENT_AUDIT_LOG_DIR: 'C:/mt-agent-audit',
      AUDIT_FLUSH_TIMEOUT_MS: '3000',
      MT_AGENT_OUTPUT_DIR: 'ignored-when-log-dir-explicit',
    });

    expect(config.remoteEnabled).toBe(false);
    expect(config.localEnabled).toBe(true);
    expect(config.ingestUrl).toBeUndefined();
    expect(config.retryEnabled).toBe(false);
    expect(config.retryMaxBatch).toBe(7);
    expect(config.logDir).toBe('C:/mt-agent-audit');
    expect(config.agentId).toBe('mt-agent.prod_1');
  });

  it('uses MT_AGENT_OUTPUT_DIR for an isolated default audit log directory', () => {
    expect(parseAuditConfig({ MT_AGENT_OUTPUT_DIR: 'C:/mt-output' }).logDir).toBe('C:/mt-output/audit');
  });

  it('validates URL, finite positive integers, bounded retry batch, flush timeout, log dir, and agent id', () => {
    expect(parseAuditConfig({ AUDIT_INGEST_URL: 'https://audit.local/v1/ingest' }).remoteEnabled).toBe(true);
    expect(parseAuditConfig({ AUDIT_RETRY_MAX_BATCH: String(AUDIT_RETRY_MAX_BATCH_LIMIT) }).retryMaxBatch).toBe(
      AUDIT_RETRY_MAX_BATCH_LIMIT,
    );

    const invalidCases: Array<Record<string, string>> = [
      { AUDIT_INGEST_URL: 'ftp://audit.local/v1/ingest' },
      { AUDIT_INGEST_URL: '/v1/ingest' },
      { AUDIT_INGEST_URL: 'https://audit.local/health' },
      { AUDIT_INGEST_URL: 'https://audit.local/v1/ingest?debug=1' },
      { AUDIT_INGEST_URL: 'https://audit.local/v1/ingest#fragment' },
      { AUDIT_INGEST_URL: 'https://user:pass@audit.local/v1/ingest' },
      { AUDIT_INGEST_TIMEOUT_MS: '0' },
      { AUDIT_INGEST_TIMEOUT_MS: '1.5' },
      { AUDIT_RETRY_MAX_BATCH: String(AUDIT_RETRY_MAX_BATCH_LIMIT + 1) },
      { AUDIT_RETRY_MAX_BATCH: '0' },
      { AUDIT_FLUSH_TIMEOUT_MS: '-1' },
      { MT_AGENT_AUDIT_LOG_DIR: ' ' },
      { MT_AGENT_AUDIT_LOG_DIR: 'output' },
      { MT_AGENT_AUDIT_AGENT_ID: '.' },
      { MT_AGENT_AUDIT_AGENT_ID: '..' },
      { MT_AGENT_AUDIT_AGENT_ID: 'mt/agent' },
      { MT_AGENT_AUDIT_AGENT_ID: 'mt\\agent' },
      { MT_AGENT_AUDIT_AGENT_ID: 'mt agent' },
    ];

    for (const env of invalidCases) {
      expect(() => parseAuditConfig(env)).toThrow(/audit config/i);
    }
  });

  it('freezes the exact selected Daily Report audit allowlist', () => {
    expect([...SELECTED_AUDIT_TOOL_NAMES].sort()).toEqual([...selectedTools].sort());
    expect(SELECTED_AUDIT_TOOL_NAMES).toHaveLength(11);
    expect(Object.isFrozen(SELECTED_AUDIT_TOOL_NAMES)).toBe(true);

    for (const toolName of selectedTools) {
      expect(isSelectedAuditTool(toolName)).toBe(true);
    }
    expect(isSelectedAuditTool('rental.bulkPriceApply')).toBe(false);
    expect(isSelectedAuditTool('publicTraffic.latestSummary.extra')).toBe(false);
  });
});
