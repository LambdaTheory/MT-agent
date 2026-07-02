import type { AgentToolConfirmRequest } from './approvalCard.js';
import { listAgentTools } from './toolRegistry.js';
import type { ExploreTool } from './agentExploreLoop.js';
import { executeAgentToolRequest, type AgentToolExecutionOptions } from '../feishuBot/agentToolExecutor.js';

export function buildReadOnlyExploreTools(outputDir: string, options: AgentToolExecutionOptions = {}): ExploreTool[] {
  return listAgentTools()
    .filter((tool) => tool.risk === 'read' && tool.plannerVisible !== false)
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
