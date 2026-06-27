import type { LlmProvider } from '../llm/provider.js';
import { listAgentPlannerTools, type AgentPlannerProvider, type AgentPlannerRequest } from './planner.js';

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
        workflows: [],
      };
      const result = await provider.generateJson({
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: [
              'You are an operations agent planner. Select exactly one registered tool, or return a multi-step plan composed only of registered tools.',
              'Never invent tool names or arguments.',
              'For atomic actions, return only a bare JSON object with goal, selectedTool, arguments, confidence, reason, and optional requiresConfirmation.',
              'For composite goals, return only a bare JSON object with goal, steps, confidence, and reason. Each step must contain toolName, arguments, and reason; it may include a stable id such as "rank".',
              'Tool metadata may include resultMetadataSchema; use those documented result fields as the valid source for later placeholders.',
              'Later steps may reference metadata from earlier steps with string placeholders such as "${rank.bestProductId}", "${rank.best.internalProductId}", or "${steps.rank.sameSkuGroupId}". Only reference prior step ids.',
              'For "find the best link/product, then copy/create/fill new links", use product.rankBestSameSku first with id "rank", then rental.newLinkBatchPlan with sourceProductId "${rank.bestProductId}". This still only creates a confirmation card before copy execution.',
              'For product pricing/status questions such as "x200u pricing/定价情况", use rental.priceSnapshot. Use rental.priceChange only when the user asks to change prices.',
              'For report conversion-rate questions such as "2026-06-22 的转化率多少" or "昨天转化数据", use publicTraffic.conversionSummary with date when present.',
              'For arbitrary read-only questions about saved public traffic report data, use publicTraffic.reportQuery. Map natural language into target, date, period, metrics, filters, sortBy, limit, section, orderPage, and orderIndicator.',
              'Examples for publicTraffic.reportQuery: "2026-06-22 访问最高的前20个商品" means target products, date 2026-06-22, period 1d unless a 7日/30日 window is mentioned, sortBy publicVisits, limit 20. "7日金额最高的10个商品" means target products, period 7d, sortBy amount, limit 10. "733 的所有日报数据" means target productDetail, productQuery 733. "较前日变化多少/比昨天涨跌多少" means target comparison. "托管异常商品有哪些" means target section, section custodyAbnormal. "各问题池分别多少条" means target sectionCounts. "订单分析里的签约发货率是多少" means target orders, orderPage overview, orderIndicator 签约发货率. "数据源有没有异常" means target dataQuality.',
              'For product-row aggregation questions over saved report rows, use publicTraffic.reportQuery with target productAggregation and aggregation count/sum/avg/min/max. Examples: "符合条件的商品有多少" means aggregation count; "7日访问总和是多少" means period 7d, metrics publicVisits, aggregation sum; "平均访问是多少" means aggregation avg; "发货最高/最低是多少" means metrics shippedOrders with aggregation max/min.',
              'For resending or pushing a saved report for a date, use publicTraffic.resendLatestReport or publicTraffic.pushLatestReportToGroup with date. Do not use publicTraffic.runReport for a historical date.',
              'For requests to change prices for all products in a named model, alias, product group, or same-SKU group, compose atomic steps: first linkRegistry.resolveProducts with id "resolve", then rental.pricePreview with productIds "${resolve.productIds}", discount as a multiplier such as 0.9 for 九折, and scope all_price_fields when the user says 整体价格/所有价格.',
              'For requests to remove/drop SKU/spec items by product group and keyword, use rental.specRemovePlan with query and keyword. It creates a dedicated confirmation card and must not be replaced by product delisting.',
              'For activity refresh goals, use operations.refreshActivityPlan; it will generate a safe execution confirmation card only when candidates, same-SKU groups, and copy sources are valid.',
              'Tools that open an interactive card or UI, such as productId.lookupCard, operationsLearning.startQuiz, inventory.statusOverview, linkRegistry.overview, activity.differentialPricingCard, and activity.cancelDifferentialPricingCard, should normally be the final step. If the user expects more work after an interactive card, ask for clarification or choose a non-card tool.',
              'Do not return selectedWorkflow unless the input explicitly includes a non-empty workflows list; normal Feishu planning intentionally exposes workflows as an empty legacy list and rejects selectedWorkflow responses.',
              'If a later step depends on a previous result that cannot be expressed with these placeholders, ask for clarification.',
              'If the goal, tool, or required arguments are unclear, return only a bare JSON object with goal, needsClarification:true, originalMessage, question, options, confidence, and reason.',
              'Clarification options must be natural-language restatements that can be planned again, each with label, message, and optional description; provide 2 to 4 options.',
              'When learningHints are present and relevant, prefer the historically selected restatement, but still validate required arguments and never skip confirmation for write or high-risk actions.',
              'For write or high-risk tools, set requiresConfirmation to true. Do not claim execution has happened.',
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
