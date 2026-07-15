import type { LlmProvider } from '../llm/provider.js';
import type { LlmToolSelectionProvider, LlmToolSelectionRequest } from './llmProvider.js';
import { readOnlyTools } from './readOnlyToolRegistry.js';

type ToolSelectionInput = Omit<LlmToolSelectionRequest, 'tools'>;

const arbitraryWindowPattern = /(?:近\s*)?\d+\s*天\s*(?:内|以内)?/u;
const metricOrConditionPattern = /访问量|公域访问|后链路访问|访问页访问|曝光|订单金额|公域交易金额|签约订单金额|创建订单|创单|金额|订单数|为\s*0|=\s*0|大于|小于|高于|低于|最高|最低|排行|排名|排序|前\s*\d+/u;

export function shouldBypassLegacyReadOnlySelection(message: string): boolean {
  return arbitraryWindowPattern.test(message) && metricOrConditionPattern.test(message);
}

export function getRegistryBackedLlmTools(): LlmToolSelectionRequest['tools'] {
  return readOnlyTools.flatMap((tool) => (tool.llm ? [{ name: tool.llm.name, description: tool.llm.description, argumentsSchema: tool.llm.argumentsSchema }] : []));
}

export function createLlmToolSelector(provider: LlmProvider): { selectTool(request: ToolSelectionInput): Promise<string> } {
  return {
    async selectTool(request) {
      if (shouldBypassLegacyReadOnlySelection(request.message)) {
        return JSON.stringify({
          intent: 'delegate_to_agent_planner',
          tool: 'none',
          arguments: {},
          confidence: 1,
          reason: '请使用数据查询工具处理任意窗口指标、筛选、排序或排名问题。',
        });
      }

      const toolRequest: LlmToolSelectionRequest = { ...request, tools: getRegistryBackedLlmTools() };
      const result = await provider.generateJson({
        temperature: 0,
        messages: [
          { role: 'system', content: 'Select exactly one read-only tool for the user message. Return only a bare JSON object matching intent, tool, arguments, confidence, and reason.' },
          { role: 'user', content: JSON.stringify(toolRequest) },
        ],
      });
      return result.text;
    },
  } satisfies LlmToolSelectionProvider;
}
