import type { DecisionRecord } from './decisionRecord.js';
import { schemaAllowsArguments } from './planner.js';
import { findAgentTool } from './toolRegistry.js';

export interface ClassifiedDecisions {
  approvals: DecisionRecord[];
  observations: DecisionRecord[];
}

function toolArgumentsValid(record: DecisionRecord): boolean {
  if (!record.proposedTool) return false;
  const tool = findAgentTool(record.proposedTool.toolName);
  return Boolean(tool && tool.plannerVisible !== false && schemaAllowsArguments(tool.inputSchema, record.proposedTool.arguments));
}

function blockedReason(record: DecisionRecord): string {
  if (!record.proposedTool) return '缺少可执行工具参数';
  const tool = findAgentTool(record.proposedTool.toolName);
  if (!tool) return '工具参数非法';
  if (tool.plannerVisible === false) return '工具不允许自动审批';
  if (!schemaAllowsArguments(tool.inputSchema, record.proposedTool.arguments)) return '工具参数非法';
  if (record.uncertainties.length > 0) return '存在不确定项';
  return '证据不足';
}

export function classifyDecisions(records: DecisionRecord[]): ClassifiedDecisions {
  const approvals: DecisionRecord[] = [];
  const observations: DecisionRecord[] = [];

  for (const record of records) {
    const executable = record.recommendation === 'approve_to_execute';
    const evidenced = record.evidenceRefs.length > 0 && record.uncertainties.length === 0;
    if (executable && evidenced && toolArgumentsValid(record)) {
      approvals.push(record);
    } else if (executable) {
      observations.push({ ...record, recommendation: 'observe', blockedReason: blockedReason(record) });
    } else {
      observations.push(record);
    }
  }

  return { approvals, observations };
}
