export type OperationPlanRisk = 'read' | 'write' | 'high';

export type OperationPlanStepStatus = 'pending' | 'ready' | 'blocked' | 'completed' | 'failed';

export interface OperationPlanStep {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  risk: OperationPlanRisk;
  requiresConfirmation: boolean;
  status: OperationPlanStepStatus;
  reason?: string;
  dependsOn?: string[];
}

export interface OperationPlan {
  id: string;
  goal: string;
  createdAt: string;
  steps: OperationPlanStep[];
  metadata?: Record<string, unknown>;
}

export interface OperationPlanJournalEntry {
  planId: string;
  at: string;
  event: string;
  stepId?: string;
  status?: OperationPlanStepStatus;
  metadata?: Record<string, unknown>;
}
