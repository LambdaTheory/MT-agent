export type AgentWorkflowRisk = 'read' | 'write' | 'high';

export interface AgentWorkflowDefinition {
  name: string;
  description: string;
  triggerExamples: string[];
  requiredCapabilities: string[];
  risk: AgentWorkflowRisk;
  requiresConfirmation: boolean;
  argumentsSchema?: unknown;
}

const workflows: AgentWorkflowDefinition[] = [
  {
    name: 'rental.newLinkBatch',
    description: '根据自然语言目标，为某个商品/同款组规划批量铺设新链；先用链接档案和公域数据选源商品，再生成复制商品批次确认计划。',
    triggerExamples: ['帮我铺十条 pocket3 的新链', '给大疆 pocket3 补 10 个新链接', '按表现最好的 pocket3 链接复制一批'],
    requiredCapabilities: [
      'llm.intentUnderstanding',
      'linkRegistry.classificationLookup',
      'publicTraffic.performanceRanking',
      'rental.copyProduct',
    ],
    risk: 'high',
    requiresConfirmation: true,
    argumentsSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string' },
        count: { type: 'integer' },
      },
      required: ['keyword', 'count'],
      additionalProperties: false,
    },
  },
];

function cloneWorkflow(workflow: AgentWorkflowDefinition): AgentWorkflowDefinition {
  return {
    ...workflow,
    triggerExamples: [...workflow.triggerExamples],
    requiredCapabilities: [...workflow.requiredCapabilities],
    argumentsSchema: workflow.argumentsSchema === undefined ? undefined : structuredClone(workflow.argumentsSchema),
  };
}

export function listAgentWorkflows(): AgentWorkflowDefinition[] {
  return workflows.map(cloneWorkflow);
}

export function findAgentWorkflow(name: string): AgentWorkflowDefinition | undefined {
  const workflow = workflows.find((candidate) => candidate.name === name);
  return workflow ? cloneWorkflow(workflow) : undefined;
}
