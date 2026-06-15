import type { LlmProvider } from '../llm/provider.js';
import type { LlmToolSelectionProvider, LlmToolSelectionRequest } from './llmProvider.js';
import { readOnlyTools } from './readOnlyToolRegistry.js';

type ToolSelectionInput = Omit<LlmToolSelectionRequest, 'tools'>;

export function getRegistryBackedLlmTools(): LlmToolSelectionRequest['tools'] {
  return readOnlyTools.flatMap((tool) => (tool.llm ? [{ name: tool.llm.name, description: tool.llm.description, argumentsSchema: tool.llm.argumentsSchema }] : []));
}

export function createLlmToolSelector(provider: LlmProvider): { selectTool(request: ToolSelectionInput): Promise<string> } {
  return {
    async selectTool(request) {
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
