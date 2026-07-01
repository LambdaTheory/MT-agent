import type { DecisionRecord } from './decisionRecord.js';

export interface ClassifiedDecisions {
  approvals: DecisionRecord[];
  observations: DecisionRecord[];
}

function blockedReason(record: DecisionRecord): string {
  if (!record.proposedTool) return '缺少可执行工具参数';
  if (record.uncertainties.length > 0) return '存在不确定项';
  return '证据不足';
}

export function classifyDecisions(records: DecisionRecord[]): ClassifiedDecisions {
  const approvals: DecisionRecord[] = [];
  const observations: DecisionRecord[] = [];

  for (const record of records) {
    const executable = record.recommendation === 'approve_to_execute';
    const evidenced = record.evidenceRefs.length > 0 && record.uncertainties.length === 0;
    if (executable && evidenced && record.proposedTool) {
      approvals.push(record);
    } else if (executable) {
      observations.push({ ...record, recommendation: 'observe', blockedReason: blockedReason(record) });
    } else {
      observations.push(record);
    }
  }

  return { approvals, observations };
}
