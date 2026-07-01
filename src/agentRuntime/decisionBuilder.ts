import type { CollectedContext } from './dailyMissionContext.js';
import type { DecisionRecord } from './decisionRecord.js';

export interface DecisionBuilder {
  build(context: CollectedContext): Promise<DecisionRecord[]>;
}

export class RuleBasedDecisionBuilder implements DecisionBuilder {
  async build(context: CollectedContext): Promise<DecisionRecord[]> {
    return (context.hotspots ?? []).map((event, index) => ({
      decisionId: `${context.runId}-obs-${index + 1}`,
      runId: context.runId,
      title: `热点临近：${event.title}`,
      subjects: event.affectedCategories.map((category) => ({
        kind: 'product' as const,
        id: category,
        displayName: category,
      })),
      operationType: 'observe',
      recommendation: 'observe',
      risk: 'read',
      rationale: [`热点事件 ${event.title} 将在 ${event.startsAt} 开始，建议观察相关品类。`],
      evidenceRefs: [`hotspots.${event.eventId}`],
      uncertainties: [],
    }));
  }
}
