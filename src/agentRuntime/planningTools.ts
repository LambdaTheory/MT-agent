export const PRE_CONFIRMATION_PLANNING_TOOLS = new Set([
  'operations.refreshActivityPlan',
  'rental.priceChange',
  'rental.pricePreview',
  'rental.bulkPricePlan',
  'rental.specRemovePlan',
  'rental.specKeywordPricePlan',
  'rental.newLinkBatchPlan',
  'rental.perSpecPricePlan',
  'rental.specDimPlan',
]);

export function isPreConfirmationPlanningTool(toolName: string): boolean {
  return PRE_CONFIRMATION_PLANNING_TOOLS.has(toolName);
}
