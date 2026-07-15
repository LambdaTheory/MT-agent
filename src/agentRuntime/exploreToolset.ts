import type { AgentToolConfirmRequest } from './approvalCard.js';
import { listAgentTools } from './toolRegistry.js';
import type { ExploreTool } from './agentExploreLoop.js';
import { executeAgentToolRequest, type AgentToolExecutionOptions } from '../feishuBot/agentToolExecutor.js';

const EXPLORE_SAFE_READ_TOOLS = new Set([
  'system.help',
  'publicTraffic.latestSummary',
  'publicTraffic.conversionSummary',
  'publicTraffic.reportQuery',
  'productLink.query',
  'product.query',
  'product.rankBestSameSku',
  'product.rankByCategory',
  'productId.lookup',
  'inventory.statusOverview',
  'inventory.statusQuery',
  'linkRegistry.overview',
  'linkRegistry.resolveProducts',
  'operationsLearning.summary',
  'operationsLearning.history',
  'agentLearning.summary',
  'publicTraffic.newLinkPool',
  'publicTraffic.taskPool',
  'publicTraffic.problemProducts',
  'publicTraffic.inactiveLinks',
  'publicTraffic.removedLinks',
  'publicTraffic.orderSummary',
  'publicTraffic.windowedFindings',
  'rental.daemonStatus',
  'rental.platformSearch',
  'rental.platformSearchAll',
  'rental.batchRead',
  'rental.specDiscoverFull',
  'rental.readRaw',
  'rental.specDiscover',
  'rental.priceSnapshot',
]);

export function buildReadOnlyExploreTools(outputDir: string, options: AgentToolExecutionOptions = {}): ExploreTool[] {
  return listAgentTools()
    .filter((tool) => tool.risk === 'read' && tool.plannerVisible !== false && EXPLORE_SAFE_READ_TOOLS.has(tool.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      run: async (args: Record<string, unknown>) => executeAgentToolRequest(
        {
          toolName: tool.name,
          arguments: args,
          reason: 'agent explore read-only tool',
        } satisfies AgentToolConfirmRequest,
        outputDir,
        options,
      ),
    }));
}
