import type { LlmProvider } from '../llm/provider.js';
import { listAgentPlannerTools, type AgentPlannerProvider, type AgentPlannerRequest } from './planner.js';
import { listAgentWorkflows } from './workflowRegistry.js';

export type AgentPlanInput = Omit<AgentPlannerRequest, 'tools' | 'workflows'>;

function currentDateInShanghai(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
}

export function createAgentPlannerProvider(provider: LlmProvider): AgentPlannerProvider {
  return {
    async proposePlan(request: AgentPlanInput) {
      const currentDate = currentDateInShanghai();
      const plannerRequest: AgentPlannerRequest = {
        ...request,
        tools: listAgentPlannerTools(),
        workflows: listAgentWorkflows(),
      };
      const result = await provider.generateJson({
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: [
              'You are an operations agent planner. Select exactly one registered tool or workflow for the user message.',
              'Never invent tool/workflow names or arguments.',
              'For atomic actions, return only a bare JSON object with goal, selectedTool, arguments, confidence, reason, and optional requiresConfirmation.',
              'For composite flows, return selectedWorkflow instead of selectedTool; local deterministic code will build the plan and execute only after confirmation.',
              'If the goal, tool, workflow, or required arguments are unclear, return only a bare JSON object with goal, needsClarification:true, originalMessage, question, options, confidence, and reason.',
              'Clarification options must be natural-language restatements that can be planned again, each with label, message, and optional description; provide 2 to 4 options.',
              'When learningHints are present and relevant, prefer the historically selected restatement, but still validate required arguments and never skip confirmation for write or high-risk actions.',
              'For write or high-risk tools/workflows, set requiresConfirmation to true. Do not claim execution has happened.',
              `Current date in Asia/Shanghai is ${currentDate}; when the user asks for a report by date or a relative date such as today/yesterday, pass date as YYYY-MM-DD when the selected tool supports a date argument.`,
            ].join(' '),
          },
          { role: 'user', content: JSON.stringify(plannerRequest) },
        ],
      });
      return result.text;
    },
  };
}
