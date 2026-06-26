export type AgentToolRisk = 'read' | 'write' | 'high';

export interface AgentToolContext {
  outputDir?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentToolDefinition<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  risk: AgentToolRisk;
  requiresConfirmation: boolean;
  plannerVisible?: boolean;
  inputSchema?: unknown;
  execute?: (input: Input, context: AgentToolContext) => Promise<Output>;
}
