import type { AgentIntent } from '../agentData/types.js';
import type { PublicTrafficDataReportContext } from '../publicTraffic/types.js';
import type { BotResponse } from './types.js';
import type { LlmToolSelection } from './llmProvider.js';
import { findReadOnlyToolByLlmName } from './readOnlyToolRegistry.js';

export type RunReadOnlyToolSelectionResult =
  | { ok: true; intent: AgentIntent; response: BotResponse }
  | { ok: false; reason: 'unsupported_tool' | 'invalid_arguments' };

export function llmToolSelectionToIntent(selection: LlmToolSelection): AgentIntent | undefined {
  const tool = findReadOnlyToolByLlmName(selection.tool);
  return tool?.llm.toIntent(selection.arguments);
}

export async function runReadOnlyToolSelection(context: PublicTrafficDataReportContext, selection: LlmToolSelection): Promise<RunReadOnlyToolSelectionResult> {
  const tool = findReadOnlyToolByLlmName(selection.tool);
  if (!tool) return { ok: false, reason: 'unsupported_tool' };

  const intent = tool.llm.toIntent(selection.arguments);
  if (!intent) return { ok: false, reason: 'invalid_arguments' };

  return { ok: true, intent, response: await tool.run(context, intent) };
}
