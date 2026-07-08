import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { interactionUsabilityCases, usabilityFailureLayers, type InteractionCategory, type InteractionResponseType, type UsabilityFailureLayer } from './interactionUsabilityCases.js';
import { buildInteractionUsabilityReport, type InteractionAuditDetail } from '../src/feishuBot/interactionUsabilityReport.js';

interface StructuredAuditReportCase {
  caseId: string;
  category: InteractionCategory;
  utterance: string;
  capability: {
    ok: boolean;
    toolName: string;
    responseType: InteractionResponseType;
    evidenceSummary: string;
  };
  routing: {
    ok: boolean;
    matchedCapability: string | null;
    responseType: InteractionResponseType;
    failureLayer: UsabilityFailureLayer | null;
    evidenceSummary: string;
  };
}

interface StructuredAuditReportArtifact {
  failureLayers: UsabilityFailureLayer[];
  responseTypes: InteractionResponseType[];
  summary: {
    totalCases: number;
    totalDetails: number;
    capabilityPassed: string[];
    routingPassed: string[];
    blockedByCapability: string[];
    blockedByRouting: string[];
    blockedByMetadata: string[];
    blockedByWorkflow: string[];
    blockedByDataHealth: string[];
    blockedByReplyChannel: string[];
  };
  cases: StructuredAuditReportCase[];
}

function readStructuredAuditReportArtifact(): StructuredAuditReportArtifact {
  const path = new URL('../docs/superpowers/specs/2026-07-08-interaction-usability-report.json', import.meta.url);
  return JSON.parse(readFileSync(path, 'utf8')) as StructuredAuditReportArtifact;
}

describe('interaction usability report', () => {
  it('groups capability and routing audit results into failure-layer buckets', () => {
    const details: InteractionAuditDetail[] = [
      { layer: 'capability', caseId: 'best-r50-20d', ok: true, toolName: 'product.rankBestSameSku', evidence: 'ranked 680' },
      { layer: 'routing', caseId: 'best-r50-20d', ok: true, utterance: '近20天数据最好r50是哪个id', matchedTool: 'product.rankBestSameSku', responseType: 'text', evidence: 'matched same sku best' },
      { layer: 'routing', caseId: 'refresh-r50-zero-amount', ok: false, utterance: '帮我下架r50近30天产生订单金额为0的链接', responseType: 'text', failureLayer: 'routing', evidence: 'planner selected generic query' },
      { layer: 'routing', caseId: 'safe-source-ref', ok: false, utterance: '安全源是谁', responseType: 'clarification_card', failureLayer: 'metadata', evidence: 'sameSkuGroupId missing' },
      { layer: 'capability', caseId: 'stale-output', ok: false, toolName: 'publicTraffic.windowAggregate', failureLayer: 'data_health', evidence: 'missing daily files' },
    ];

    const report = buildInteractionUsabilityReport(details, { generatedAt: '2026-07-08T00:00:00.000Z' });

    expect(report).toMatchObject({
      generatedAt: '2026-07-08T00:00:00.000Z',
      capabilityPassed: ['best-r50-20d'],
      routingPassed: ['best-r50-20d'],
      blockedByRouting: ['refresh-r50-zero-amount'],
      blockedByMetadata: ['safe-source-ref'],
      blockedByDataHealth: ['stale-output'],
      blockedByCapability: [],
      blockedByWorkflow: [],
      blockedByReplyChannel: [],
      details,
    });
  });

  it('does not classify a routing failure as capability when direct capability passed', () => {
    const report = buildInteractionUsabilityReport([
      { layer: 'capability', caseId: 'best-r50-20d', ok: true, toolName: 'product.rankBestSameSku', evidence: 'direct tool passed' },
      { layer: 'routing', caseId: 'best-r50-20d', ok: false, utterance: '近20天数据最好r50是哪个id', responseType: 'text', failureLayer: 'capability', evidence: 'planner missed the tool' },
    ], { generatedAt: '2026-07-08T00:00:00.000Z' });

    expect(report.blockedByCapability).toEqual([]);
    expect(report.blockedByRouting).toEqual(['best-r50-20d']);
  });

  it('keeps the committed structured report artifact aligned with the source case matrix', () => {
    const artifact = readStructuredAuditReportArtifact();
    const caseIds = interactionUsabilityCases.map((item) => item.id);

    expect(artifact.failureLayers).toEqual([...usabilityFailureLayers]);
    expect(artifact.summary.totalCases).toBe(interactionUsabilityCases.length);
    expect(artifact.summary.totalDetails).toBe(interactionUsabilityCases.length * 2);
    expect(artifact.summary.capabilityPassed).toEqual(caseIds);
    expect(artifact.summary.blockedByCapability).toEqual([]);
    expect(artifact.cases.map((item) => item.caseId)).toEqual(caseIds);

    for (const sourceCase of interactionUsabilityCases) {
      const artifactCase = artifact.cases.find((item) => item.caseId === sourceCase.id);

      expect(artifactCase).toBeDefined();
      expect(artifactCase).toMatchObject({
        category: sourceCase.category,
        utterance: sourceCase.utterance,
        capability: {
          ok: true,
          toolName: sourceCase.capabilityExpectation.toolName,
        },
        routing: {
          failureLayer: artifact.summary.routingPassed.includes(sourceCase.id) ? null : sourceCase.expectedFailureLayer,
        },
      });
      expect(artifactCase?.capability.evidenceSummary).not.toHaveLength(0);
      expect(artifactCase?.routing.evidenceSummary).not.toHaveLength(0);
    }
  });
});
