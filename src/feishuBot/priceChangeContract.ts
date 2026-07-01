export const PRICE_ADJUSTMENT_CONFLICT_MESSAGE =
  'Invalid price adjustment arguments: discount and adjustmentAmount cannot be used together.';

export const INVALID_DISCOUNT_ARGUMENT_MESSAGE =
  'Invalid price adjustment arguments: discount must be an explicit multiplier such as 0.8 for 8-fold or 1.8 for 180%.';

export function hasPriceAdjustmentConflict(args: Record<string, unknown>): boolean {
  return args.discount !== undefined && args.adjustmentAmount !== undefined;
}
