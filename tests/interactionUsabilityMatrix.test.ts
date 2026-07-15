import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAgentDataIntent } from '../src/agentData/intent.js';
import type { AgentIntent } from '../src/agentData/types.js';
import { buildInteractionUsabilityReport } from '../src/feishuBot/interactionUsabilityReport.js';
import { executeAgentToolRequest } from '../src/feishuBot/agentToolExecutor.js';
import { parseBotIntent } from '../src/feishuBot/intent.js';
import { handleBotIntent } from '../src/feishuBot/tools.js';
import type { BotIntent, BotResponse } from '../src/feishuBot/types.js';
import { interactionUsabilityCases, usabilityFailureLayers, type InteractionCase, type UsabilityFailureLayer } from './interactionUsabilityCases.js';

interface CapabilityAuditResult {
  layer: 'capability';
  caseId: string;
  ok: boolean;
  toolName: string;
  evidence: string;
  failureLayer?: UsabilityFailureLayer;
}

interface RoutingAuditResult {
  layer: 'routing';
  caseId: string;
  ok: boolean;
  utterance: string;
  matchedTool?: string;
  responseType: 'text' | 'clarification_card' | 'strategy_card' | 'execute_confirm_card' | 'none';
  failureLayer?: UsabilityFailureLayer;
  evidence: string;
}

const metric = {
  exposure: 0,
  publicVisits: 0,
  dashboardVisits: 0,
  createdOrders: 0,
  signedOrders: 0,
  reviewedOrders: 0,
  shippedOrders: 0,
  amount: 0,
  exposureVisitRate: 0,
  visitCreatedOrderRate: 0,
  visitShipmentRate: 0,
  hasExposureData: true,
  hasDashboardData: true,
};

async function writeJson(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value), 'utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function reportContext(date: string) {
  return {
    date,
    summary: { '1d': metric, '7d': metric, '30d': metric },
    conclusions: [],
    dataQualityNotes: ['30d 访问页缺失 1 条'],
    rows: [
      {
        productName: 'R50 健康源',
        platformProductId: 'p680',
        displayProductId: '端内ID 680',
        custodyDays: 50,
        periods: {
          '1d': { ...metric, exposure: 20, amount: 100, shippedOrders: 1 },
          '7d': { ...metric, exposure: 80, amount: 300, shippedOrders: 2, publicVisits: 12 },
          '30d': { ...metric, exposure: 600, amount: 900, createdOrders: 3, shippedOrders: 3 },
        },
      },
      {
        productName: 'R50 金额为0',
        platformProductId: 'p681',
        displayProductId: '端内ID 681',
        custodyDays: 45,
        periods: {
          '1d': { ...metric, exposure: 0, amount: 0 },
          '7d': { ...metric, exposure: 10, amount: 0 },
          '30d': { ...metric, exposure: 240, publicVisits: 24, dashboardVisits: 18, createdOrders: 2, amount: 0 },
        },
      },
      {
        productName: 'R50 查询样本',
        platformProductId: 'p956',
        displayProductId: '端内ID 956',
        custodyDays: 45,
        periods: {
          '1d': { ...metric, exposure: 3, amount: 10, shippedOrders: 1 },
          '7d': { ...metric, exposure: 30, amount: 100, shippedOrders: 2 },
          '30d': { ...metric, exposure: 90, publicVisits: 20, dashboardVisits: 15, createdOrders: 2, amount: 180 },
        },
      },
      {
        productName: 'Pocket 3 全局零金额',
        platformProductId: 'p901',
        displayProductId: '端内ID 901',
        custodyDays: 45,
        periods: {
          '1d': { ...metric, exposure: 5, amount: 0 },
          '7d': { ...metric, exposure: 20, amount: 0 },
          '30d': { ...metric, exposure: 500, publicVisits: 50, dashboardVisits: 40, createdOrders: 1, amount: 0 },
        },
      },
    ],
    lowExposure: [],
    weakClick: [],
    weakConversion: [],
    highPotential: [],
    newProductObservation: [],
    lifecycleGovernance: [],
    recommendedActions: [],
    emptySectionNotes: {},
  };
}

async function writeInteractionAuditFixtures() {
  const rootDir = await mkdtemp(join(tmpdir(), 'mt-interaction-audit-'));
  const outputDir = join(rootDir, 'output');
  const configDir = join(rootDir, 'config');
  const stateDir = join(outputDir, 'state');
  await mkdir(join(outputDir, '2026-07-01'), { recursive: true });
  await mkdir(join(outputDir, '2026-07-02'), { recursive: true });
  await mkdir(configDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });

  for (const date of ['2026-07-01', '2026-07-02']) {
    const context = reportContext(date);
    await writeJson(join(outputDir, date, 'report-context.json'), context);
    await writeJson(join(outputDir, date, `公域数据上下文_${date}.json`), context);
  }
  await writeJson(join(configDir, 'product-id-map.json'), { p680: '680', p681: '681', p901: '901', p956: '956', '2026013022000994654214': '956' });
  await writeJson(join(configDir, 'product-name-map.json'), { '680': 'R50 健康源', '681': 'R50 金额为0', '901': 'Pocket 3 全局零金额', '956': 'R50 查询样本' });
  await writeJson(join(configDir, 'link-registry-overrides.json'), {
    version: 1,
    entries: [
      { internalProductId: '680', platformProductId: 'p680', productName: 'R50 健康源', shortName: 'R50', aliases: ['r50'], sameSkuGroupId: 'canon-eos-r50', categoryName: '相机', status: 'active' },
      { internalProductId: '681', platformProductId: 'p681', productName: 'R50 金额为0', shortName: 'R50', aliases: ['r50'], sameSkuGroupId: 'canon-eos-r50', categoryName: '相机', status: 'active' },
      { internalProductId: '956', platformProductId: '2026013022000994654214', productName: 'R50 查询样本', shortName: 'R50', aliases: ['r50'], sameSkuGroupId: 'canon-eos-r50', categoryName: '相机', status: 'active' },
      { internalProductId: '901', platformProductId: 'p901', productName: 'Pocket 3 全局零金额', shortName: 'Pocket 3', aliases: ['pocket3'], sameSkuGroupId: 'dji-pocket-3', categoryName: '云台相机', status: 'active' },
    ],
    sameSkuGroupAliasRules: [
      { sameSkuGroupId: 'canon-eos-r50', aliases: ['r50', 'EOS R50'] },
      { sameSkuGroupId: 'dji-pocket-3', aliases: ['pocket3', 'Pocket 3'] },
    ],
  });

  return {
    outputDir,
    registryPaths: {
      productIdMapPath: join(configDir, 'product-id-map.json'),
      productNameMapPath: join(configDir, 'product-name-map.json'),
      goodsSnapshotPath: join(stateDir, 'goods-current-snapshot.json'),
      firstSeenPath: join(stateDir, 'goods-first-seen.json'),
      lifecyclePath: join(stateDir, 'goods-link-lifecycle.json'),
      daemonCatalogPath: join(stateDir, 'link-registry-daemon-catalog.json'),
      overridesPath: join(configDir, 'link-registry-overrides.json'),
      artifactsDir: outputDir,
    },
  };
}

function summarizeEvidence(toolName: string, metadata: unknown, text: string): string {
  const metadataText = isRecord(metadata) ? JSON.stringify(metadata) : '{}';
  return `${toolName}: ${metadataText}; ${text.slice(0, 120)}`;
}

async function runCapabilityAuditCase(item: InteractionCase, context: Awaited<ReturnType<typeof writeInteractionAuditFixtures>>): Promise<CapabilityAuditResult> {
  const response = await executeAgentToolRequest(
    {
      toolName: item.capabilityExpectation.toolName,
      arguments: item.capabilityExpectation.arguments ?? {},
      reason: `interaction usability capability audit: ${item.utterance}`,
    },
    context.outputDir,
    { closedOrderRegistryPaths: context.registryPaths },
  );
  const ok = isRecord(response.metadata) ? response.metadata.ok !== false : Boolean(response.text || response.card);

  return {
    layer: 'capability',
    caseId: item.id,
    ok,
    toolName: item.capabilityExpectation.toolName,
    evidence: summarizeEvidence(item.capabilityExpectation.toolName, response.metadata, response.text),
    ...(ok ? {} : { failureLayer: 'capability' as const }),
  };
}

function responseTypeOf(response: BotResponse): RoutingAuditResult['responseType'] {
  if (!response.text && !response.card) return 'none';
  if (!response.card) return 'text';
  const cardText = JSON.stringify(response.card).toLowerCase();
  if (cardText.includes('clarification')) return 'clarification_card';
  if (cardText.includes('refresh_activity')) return 'strategy_card';
  return 'execute_confirm_card';
}

function responseMatchedTool(response: BotResponse): string | undefined {
  if (isRecord(response.metadata) && typeof response.metadata.toolName === 'string') return response.metadata.toolName;
  return undefined;
}

function responseWasAccepted(response: BotResponse): boolean {
  return !isRecord(response.metadata) || (response.metadata.ok !== false && response.metadata.declined !== true);
}

function matchedToolFromBotIntent(intent: BotIntent): string | undefined {
  switch (intent.type) {
    case 'query_product':
      return 'product.query';
    case 'latest_summary':
      return 'publicTraffic.reportQuery';
    case 'lookup_product_id':
      return 'productId.lookup';
    default:
      return undefined;
  }
}

function matchedToolFromAgentIntent(intent: AgentIntent): string | undefined {
  switch (intent.type) {
    case 'product':
      return 'product.query';
    case 'best_product_by_same_sku':
      return 'product.rankBestSameSku';
    case 'refresh_candidate_explain':
      return 'strategy.refreshCandidateExplain';
    case 'safe_source_resolve':
    case 'safe_source_groups':
      return 'strategy.safeSourceResolve';
    case 'overview':
    case 'order_summary':
      return 'publicTraffic.reportQuery';
    default:
      return undefined;
  }
}

async function runRoutingAuditCase(item: InteractionCase, context: Awaited<ReturnType<typeof writeInteractionAuditFixtures>>): Promise<RoutingAuditResult> {
  const botIntent = parseBotIntent(item.utterance);
  const agentIntent = parseAgentDataIntent(item.utterance);
  const response = await handleBotIntent(
    botIntent,
    context.outputDir,
    { closedOrderRegistryPaths: context.registryPaths },
  );
  const responseType = responseTypeOf(response);
  const matchedTool = responseMatchedTool(response) ?? matchedToolFromBotIntent(botIntent) ?? matchedToolFromAgentIntent(agentIntent);
  const ok = responseWasAccepted(response) && matchedTool === item.capabilityExpectation.toolName && responseType === item.expectedResponseType;

  return {
    layer: 'routing',
    caseId: item.id,
    ok,
    utterance: item.utterance,
    ...(matchedTool ? { matchedTool } : {}),
    responseType,
    ...(ok ? {} : { failureLayer: item.expectedFailureLayer }),
    evidence: `${item.utterance} -> bot=${botIntent.type}, agent=${agentIntent.type}, matched=${matchedTool ?? 'none'}, response=${responseType}: ${response.text.slice(0, 120)}`,
  };
}

describe('interaction usability matrix cases', () => {
  it('defines auditable interactions with capability expectations', () => {
    expect(interactionUsabilityCases.length).toBeGreaterThanOrEqual(12);

    for (const item of interactionUsabilityCases) {
      expect(item.id).toMatch(/^[a-z0-9-]+$/);
      expect(['query', 'window', 'strategy', 'plan', 'execute', 'multistep']).toContain(item.category);
      expect(item.utterance.trim()).toBe(item.utterance);
      expect(item.capabilityExpectation.toolName).toMatch(/^[a-zA-Z0-9.]+$/);
      expect(usabilityFailureLayers).toContain(item.expectedFailureLayer);
    }
  });

  it('audits every capability-layer case through direct tools', async () => {
    const context = await writeInteractionAuditFixtures();

    for (const item of interactionUsabilityCases) {
      const result = await runCapabilityAuditCase(item, context);

      expect(result).toMatchObject({ caseId: item.id, ok: true, toolName: item.capabilityExpectation.toolName });
      expect(result.evidence).toContain(item.capabilityExpectation.toolName);
      expect(result.failureLayer).toBeUndefined();
    }
  });

  it('audits every NL-routing case through real parser and handleBotIntent surfaces', async () => {
    const context = await writeInteractionAuditFixtures();

    for (const item of interactionUsabilityCases) {
      const result = await runRoutingAuditCase(item, context);

      expect(result.caseId).toBe(item.id);
      expect(result.responseType).toMatch(/^(text|clarification_card|strategy_card|execute_confirm_card|none)$/);
      expect(result.evidence).toContain(item.utterance);
      if (!result.ok) expect(result.failureLayer).toBe(item.expectedFailureLayer);
    }
  });

  it('builds a structured report from paired capability and NL-routing audit results', async () => {
    const context = await writeInteractionAuditFixtures();
    const capabilityResults = await Promise.all(interactionUsabilityCases.map((item) => runCapabilityAuditCase(item, context)));
    const routingResults = await Promise.all(interactionUsabilityCases.map((item) => runRoutingAuditCase(item, context)));

    const report = buildInteractionUsabilityReport([...capabilityResults, ...routingResults], { generatedAt: '2026-07-08T00:00:00.000Z' });

    expect(report.details).toHaveLength(interactionUsabilityCases.length * 2);
    expect(report.capabilityPassed).toHaveLength(interactionUsabilityCases.length);
    expect(report.routingPassed).toEqual(['query-status-956', 'daily-summary']);
    expect(report.blockedByCapability).toEqual([]);
    expect([...report.blockedByRouting, ...report.blockedByMetadata, ...report.blockedByWorkflow].length).toBeGreaterThan(0);
  });
});
