import { describe, expect, it, vi } from 'vitest';
import { createPublicTrafficSourcesCrawlTool } from '../src/agentRuntime/publicTrafficCrawlTool.js';
import { findAgentTool, listAgentTools } from '../src/agentRuntime/toolRegistry.js';
import type { AgentConfig, RawTableData } from '../src/domain/types.js';
import type { PublicTrafficSourcesCrawlResult } from '../src/crawler/publicTrafficCrawler.js';

function config(): AgentConfig {
  return {
    targetUrl: 'https://example.test/dashboard',
    exposureUrl: 'https://example.test/exposure',
    periods: ['1d'],
    preferredPageSize: 100,
    outputDir: 'output',
    browserProfileDir: 'profile',
  };
}

function crawlResult(goodsExportPath: string): PublicTrafficSourcesCrawlResult {
  return {
    goodsExportPath,
    exposure: {
      overview: [],
      products: [],
      paginationStats: {
        pageRowCounts: [],
        uniquePageSignatures: [],
        duplicatePageSignatures: 0,
        maxRepeatedSignatureAttempts: 0,
        duplicateProductRows: 0,
        skippedProductIdRows: 0,
      },
      url: 'https://example.test/exposure',
    },
    dashboard: [] satisfies RawTableData[],
    orderAnalysis: {
      capturedAt: '2026-06-18T00:00:00.000Z',
      pages: {
        overview: { key: 'overview', label: '标准订单分析', dataDate: null, indicators: [] },
        delivery: { key: 'delivery', label: '发货分析', dataDate: null, indicators: [] },
        return: { key: 'return', label: '归还分析', dataDate: null, indicators: [] },
        customs: { key: 'customs', label: '关单分析', dataDate: null, indicators: [] },
      },
    },
  };
}

describe('public traffic crawl runtime tool', () => {
  it('registers the scraping boundary as a direct non-product write tool', () => {
    expect(listAgentTools().map((tool) => tool.name)).not.toContain('publicTraffic.crawlSources');
    expect(findAgentTool('publicTraffic.crawlSources')).toBeUndefined();

    const tool = createPublicTrafficSourcesCrawlTool();
    expect(tool).toMatchObject({
      name: 'publicTraffic.crawlSources',
      risk: 'write',
      requiresConfirmation: false,
      inputSchema: { type: 'object', properties: { goodsExportPath: { type: 'string' } }, required: ['goodsExportPath'], additionalProperties: false },
    });
  });

  it('does not crawl until execute is called explicitly', async () => {
    const crawl = vi.fn(async (_config: AgentConfig, goodsExportPath: string) => crawlResult(goodsExportPath));
    const tool = createPublicTrafficSourcesCrawlTool({ crawl });

    expect(crawl).not.toHaveBeenCalled();

    await expect(tool.execute?.({ goodsExportPath: 'output/goods.xlsx' }, { metadata: { config: config() } })).resolves.toEqual(crawlResult('output/goods.xlsx'));
    expect(crawl).toHaveBeenCalledWith(config(), 'output/goods.xlsx');
  });

  it('rejects invalid runtime input before reaching the crawler', async () => {
    const crawl = vi.fn(async (_config: AgentConfig, goodsExportPath: string) => crawlResult(goodsExportPath));
    const tool = createPublicTrafficSourcesCrawlTool({ crawl });

    await expect(tool.execute?.({}, { metadata: { config: config() } })).rejects.toThrow('publicTraffic.crawlSources requires goodsExportPath');
    await expect(tool.execute?.({ goodsExportPath: 'output/goods.xlsx' }, { metadata: {} })).rejects.toThrow('publicTraffic.crawlSources requires AgentConfig');
    expect(crawl).not.toHaveBeenCalled();
  });
});
