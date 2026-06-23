import { crawlPublicTrafficSources, type PublicTrafficSourcesCrawlResult } from '../crawler/publicTrafficCrawler.js';
import type { AgentConfig } from '../domain/types.js';
import type { AgentToolDefinition } from './tool.js';

export interface PublicTrafficSourcesCrawlToolInput {
  goodsExportPath: string;
}

export interface PublicTrafficSourcesCrawlToolDependencies {
  crawl?: (config: AgentConfig, goodsExportPath: string) => Promise<PublicTrafficSourcesCrawlResult>;
}

const inputSchema = {
  type: 'object',
  properties: { goodsExportPath: { type: 'string' } },
  required: ['goodsExportPath'],
  additionalProperties: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAgentConfig(value: unknown): value is AgentConfig {
  if (!isRecord(value)) return false;
  return typeof value.targetUrl === 'string' && Array.isArray(value.periods) && typeof value.outputDir === 'string' && typeof value.browserProfileDir === 'string';
}

function readInput(value: unknown): PublicTrafficSourcesCrawlToolInput {
  if (!isRecord(value) || typeof value.goodsExportPath !== 'string' || !value.goodsExportPath.trim()) {
    throw new Error('publicTraffic.crawlSources requires goodsExportPath');
  }
  return { goodsExportPath: value.goodsExportPath };
}

export function createPublicTrafficSourcesCrawlTool(dependencies: PublicTrafficSourcesCrawlToolDependencies = {}): AgentToolDefinition<unknown, PublicTrafficSourcesCrawlResult> {
  const crawl = dependencies.crawl ?? crawlPublicTrafficSources;
  return {
    name: 'publicTraffic.crawlSources',
    description: '抓取公域日报所需的商品总表、曝光、后链路与订单分析原始数据',
    risk: 'write',
    requiresConfirmation: true,
    inputSchema,
    async execute(input, context) {
      const parsedInput = readInput(input);
      const config = context.metadata?.config;
      if (!isAgentConfig(config)) throw new Error('publicTraffic.crawlSources requires AgentConfig');
      return crawl(config, parsedInput.goodsExportPath);
    },
  };
}
