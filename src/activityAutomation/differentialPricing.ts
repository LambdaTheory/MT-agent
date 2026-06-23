export interface DifferentialPricingDraft {
  activityName?: string;
  productIds: string[];
  pricingRuleDescription?: string;
  startsAt?: string;
  endsAt?: string;
  discounts?: DifferentialPricingDiscountValues;
}

export interface DifferentialPricingDiscountValues {
  SS: string;
  S: string;
  A: string;
  B: string;
}

export interface DifferentialPricingAutomationInput {
  draft: DifferentialPricingDraft;
  confirmSubmit: false;
}

export function createEmptyDifferentialPricingDraft(): DifferentialPricingDraft {
  return { productIds: [] };
}
