import type { CollectedContext } from './dailyMissionContext.js';
import { isValidDecisionRecord } from './decisionRecord.js';
import type { DecisionRecord } from './decisionRecord.js';
import { listAgentTools } from './toolRegistry.js';
import type { LlmProvider } from '../llm/provider.js';

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

const DECISION_SYSTEM_PROMPT = [
  '你是租赁商品运营决策助手。基于给定的运营上下文 JSON，产出结构化决策。',
  '只输出 JSON，形如 {"decisions": DecisionRecord[]}。',
  '每条 DecisionRecord 必含 decisionId, runId, title, subjects, operationType, recommendation, risk, rationale, evidenceRefs, uncertainties。',
  'recommendation 取值 observe|approve_to_execute|skip；不确定时用 observe。evidenceRefs 必须引用上下文中的字段。',
].join('\n');

function buildToolCatalogPrompt(): string {
  const tools = listAgentTools().filter((tool) => tool.plannerVisible !== false);
  return [
    '可用可执行工具（proposedTool.toolName 只能取以下之一）：',
    ...tools.map((tool) => `- ${tool.name}: ${tool.description}`),
  ].join('\n');
}

export class LlmDecisionBuilder implements DecisionBuilder {
  constructor(private readonly options: { provider: LlmProvider }) {}

  async build(context: CollectedContext): Promise<DecisionRecord[]> {
    const result = await this.options.provider.generateJson({
      messages: [
        { role: 'system', content: `${DECISION_SYSTEM_PROMPT}\n\n${buildToolCatalogPrompt()}` },
        { role: 'user', content: JSON.stringify(context) },
      ],
      temperature: 0,
    });
    const raw = result.json.decisions;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((record, index) => (isValidDecisionRecord(record) ? { ...record, runId: context.runId } : invalidLlmDecision(context, index)))
  }
}

function invalidLlmDecision(context: CollectedContext, index: number): DecisionRecord {
  return {
    decisionId: `${context.runId}-llm-invalid-${index + 1}`,
    runId: context.runId,
    title: 'LLM 决策未通过数据契约校验',
    subjects: [{ kind: 'link', id: `daily-mission:${context.date}` }],
    operationType: 'observe',
    recommendation: 'observe',
    risk: 'read',
    rationale: ['LLM 返回了不符合 DecisionRecord 数据契约的决策，已降级为观察项。'],
    evidenceRefs: ['llm.validation'],
    uncertainties: [],
    blockedReason: 'LLM 决策未通过数据契约校验',
  };
}
