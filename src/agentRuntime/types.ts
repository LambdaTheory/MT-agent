import type { AuditContext } from '../audit/types.js';
import type { AuditWriter } from '../audit/auditLogger.js';

export type AgentRequestSource = 'feishu' | 'cli' | 'api' | 'agent' | 'scheduler';

export interface AgentAuditDependencies {
  auditContext: AuditContext;
  auditLogger?: AuditWriter;
  activateAudit(toolName: string): Promise<AuditContext | undefined>;
}

export interface AgentActor {
  id?: string;
  name?: string;
}

export interface AgentChannel {
  id?: string;
  type?: 'direct' | 'group' | 'unknown';
}

export interface AgentRequest {
  source: AgentRequestSource;
  text: string;
  actor?: AgentActor;
  channel?: AgentChannel;
  metadata?: Record<string, unknown>;
}

export interface AgentResponse {
  text: string;
  progressCard?: unknown;
  card?: unknown;
  skipped?: boolean;
  metadata?: Record<string, unknown>;
}
