export function readPriceAdjustmentAmountArgument(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  if (!Number.isFinite(numeric) || numeric === 0) return null;
  return numeric;
}

export function inferPriceAdjustmentAmountFromText(text: string): number | null {
  const compact = text.replace(/\s+/g, '');
  if (/%|％/.test(compact)) return null;
  const hasAmountCue = /金额|按金额|元|块|加价|减价|降价|涨价|上调|下调/.test(compact);
  if (!hasAmountCue) return null;

  const signed = /([+-]\d+(?:\.\d+)?)(?:元|块)?/.exec(compact);
  if (signed?.[1]) return readPriceAdjustmentAmountArgument(signed[1]);

  const negative = /(?:减|降|下调)(?:价|低|少)?(\d+(?:\.\d+)?)(?:元|块)?/.exec(compact);
  if (negative?.[1]) return readPriceAdjustmentAmountArgument(-Number(negative[1]));

  const positive = /(?:加|涨|上调)(?:价|高|多)?(\d+(?:\.\d+)?)(?:元|块)?/.exec(compact);
  if (positive?.[1]) return readPriceAdjustmentAmountArgument(Number(positive[1]));

  return null;
}

export function hasExplicitRentAdjustmentScope(text: string): boolean {
  const compact = text.replace(/\s+/g, '');
  return /所有租期|全部租期|全部租金|所有租金|所有价格|整体|全局|每个租金字段|全部价格字段/.test(compact);
}
