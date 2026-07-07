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
              'For link registry count/list questions such as "acepro2 has how many links", "acepro2 有多少条链接", "链接总数", or "有哪些端内ID", use linkRegistry.resolveProducts. Do not answer link-count questions with publicTraffic.reportQuery productAggregation, because report rows are traffic rows, not the authoritative link registry.',
              'For simple single-date report conversion-rate questions such as "2026-06-22 的转化率多少" or "昨天转化数据", use publicTraffic.conversionSummary with date when present.',
              'For report comparison questions such as "上周转化率与本周比", "本周和上周转化率对比", "7日转化率环比", or "和前一段比变化多少", use publicTraffic.reportQuery with target dateComparison. Use period 7d for week/上周/本周, period 30d for month/月, and compareWith previousPeriod unless the user gives an explicit compareDate.',
              'For arbitrary read-only questions about saved public traffic report data, use publicTraffic.reportQuery. Map natural language into target, date, period, metrics, filters, sortBy, limit, section, orderPage, and orderIndicator.',
              'Examples for publicTraffic.reportQuery: "2026-06-22 访问最高的前20个商品" means target products, date 2026-06-22, period 1d unless a 7日/30日 window is mentioned, sortBy publicVisits, limit 20. "7日金额最高的10个商品" means target products, period 7d, sortBy amount, limit 10. "733 的所有日报数据" means target productDetail, productQuery 733. "较前日变化多少/比昨天涨跌多少" means target comparison. "托管异常商品有哪些" means target section, section custodyAbnormal. "各问题池分别多少条" means target sectionCounts. "订单分析里的签约发货率是多少" means target orders, orderPage overview, orderIndicator 签约发货率. "数据源有没有异常" means target dataQuality.',
              'For product-row aggregation questions over saved report rows, use publicTraffic.reportQuery with target productAggregation and aggregation count/sum/avg/min/max. Examples: "符合条件的商品有多少" means aggregation count; "7日访问总和是多少" means period 7d, metrics publicVisits, aggregation sum; "平均访问是多少" means aggregation avg; "发货最高/最低是多少" means metrics shippedOrders with aggregation max/min.',
              'For source coverage questions about saved product rows, use publicTraffic.reportQuery with target sourceCoverage. Examples: "访问页缺失哪些商品" means source dashboard, coverageStatus missing; "7日曝光页是否完整" means period 7d, source exposure, coverageStatus all; "哪些商品曝光页或访问页没更新" means source all, coverageStatus missing.',
              'For arbitrary saved public traffic windows such as "近15天", "近20天", or other non-1/7/30 product metrics, use publicTraffic.windowAggregate with windowDays and date/endDate instead of approximating with 30d summaries.',
              'For questions asking why a group has zero refresh candidates, use strategy.refreshCandidateExplain with query or sameSkuGroupId and zeroMetric. Do not jump directly to operations.refreshActivityPlan for explanation-only questions.',
              'For questions asking whether a same-SKU group can be refilled or who the safe source product is, use strategy.safeSourceResolve. Do not jump directly to operations.refreshActivityPlan for safe-source-only questions.',
              'For derived order business metrics, use publicTraffic.reportQuery with target orderDerived. Examples: "关单率是否达标" means orderDerivedMetric closeRateStatus; "关单率多少" means orderDerivedMetric closeRate; "客单价多少" means averageOrderValue; "发货率多少" means shipmentRate; "履约链路怎么样" means fulfillmentRates.',
              'For resending or pushing a saved report for a date, use publicTraffic.resendLatestReport or publicTraffic.pushLatestReportToGroup with date. Do not use publicTraffic.runReport for a historical date.',
              'For price-change requests with an explicit internal product id such as "914整体改价 0.99", treat the id as one product only: use rental.pricePreview directly with productIds ["914"], discount 0.99, and scope rent_fields. The words 整体调价/全局改价/整体价格 mean all rental-period price fields on the specified product, not non-rental fields and not the whole same-SKU group.',
              'For amount-based price changes such as "整体价格 -1", "按金额减1", or "每个租金降1元", use rental.pricePreview adjustmentAmount -1 and scope rent_fields. Positive adjustmentAmount adds money; negative adjustmentAmount subtracts money. Do not put amount deltas in discount.',
              'For delisting/down-shelving multiple explicit internal product ids, use rental.delistBatch with productIds as an array. Do not emit one rental.delist step per id, and do not ask for productId when the message already contains numeric ids. For a single id, rental.delist with productId is fine.',
              'For requests to change prices for all products in a named model, alias, product group, or same-SKU group, compose atomic steps: first linkRegistry.resolveProducts with id "resolve" and resolutionMode "sameSkuGroup", then rental.pricePreview with productIds "${resolve.productIds}", discount as a multiplier such as 0.9 for 九折 or 1.8 for 调价1.8/1.8倍, or adjustmentAmount for amount deltas, and scope rent_fields. Never include marketPrice, deposit, purchasePrice, costPrice, or finalPayment unless the user explicitly names that exact field.',
              'For requests to remove/drop SKU/spec items by product group and keyword, use rental.specRemovePlan with query and keyword. If the user provides multiple internal product ids, keep them together as one comma-separated query instead of creating one step per id. It creates a dedicated confirmation card and must not be replaced by product delisting.',
              'For activity refresh goals, use operations.refreshActivityPlan. When the user names a product/model/group, pass query or sameSkuGroupId to keep the plan targeted. When the user says 订单金额为0/金额为0, pass zeroMetric amount; when they say 创单为0/订单数为0, pass zeroMetric created_orders. The plan returns a strategy choice card for 只下架 or 下架+补链; confirmed execution still uses operations.refreshActivityExecute and may skip blocker groups for partial execution.',
              'Tools that open an interactive card or UI, such as productId.lookupCard, operationsLearning.startQuiz, inventory.statusOverview, linkRegistry.overview, activity.differentialPricingCard, and activity.cancelDifferentialPricingCard, should normally be the final step. If the user expects more work after an interactive card, ask for clarification or choose a non-card tool.',
              'Do not return selectedWorkflow unless the input explicitly includes a non-empty workflows list; normal Feishu planning intentionally exposes workflows as an empty legacy list and rejects selectedWorkflow responses.',
              'If a later step depends on a previous result that cannot be expressed with these placeholders, ask for clarification.',
              'If the goal, tool, or required arguments are unclear, return only a bare JSON object with goal, needsClarification:true, originalMessage, question, options, confidence, and reason.',
              'Clarification options must provide 2 to 4 options. Each option must include label, toolName chosen from the registered tools, arguments with known values filled when available, optional description, and message as a natural-language fallback restatement. Unknown arguments may be omitted. When clarifying which action to take for a known target, bind each option to a concrete tool. Only use message-only options when the input cannot be mapped to any registered tool.',
              'When learningHints are present and relevant, prefer the historically selected restatement, but still validate required arguments and never skip confirmation for product-modifying actions.',
              'Product-modifying tools require confirmation. This includes rental.copy, rental.delist, rental.delistBatch, rental.tenancySet, rental.specAddAndRefresh, rental.specRemovePlan, rental.priceChange, rental.pricePreview, rental.newLinkBatchPlan, rental.priceRollback, rental.priceApply, rental.operationConfirmRequest, and operations.refreshActivityExecute. Public traffic report generation and dashboard refresh also require confirmation because they trigger heavy crawl/report workflows. Other non-product operational tools such as saved-report resend/push and closed-order sync/report may run directly when tool metadata says requiresConfirmation false. Do not claim execution has happened until the tool result is returned.',
              `Current date in Asia/Shanghai is ${currentDate}; when the user asks for a report by date or a relative date such as today/yesterday, pass date as YYYY-MM-DD when the selected tool supports a date argument. Normalize short report dates such as 26.6.18, 2026.6.18, 6.18, or 6月18日 to YYYY-MM-DD before planning when the year is clear or can be inferred from the current year.`,
            ].join(' '),
          },
          { role: 'user', content: JSON.stringify(plannerRequest) },
        ],
      });
      return result.text;
    },
  };
}
