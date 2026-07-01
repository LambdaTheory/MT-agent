function chineseDigitValue(value: string): number | null {
  const map: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  return map[value] ?? null;
}

function normalizeExplicitMultiplier(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return value <= 5 ? value : null;
}

function inferRelativePercentMultiplier(compact: string): number | null {
  const percent = /(\d+(?:\.\d+)?)[%％]/.exec(compact);
  if (!percent?.[1]) return null;
  const value = Number(percent[1]);
  if (!Number.isFinite(value) || value <= 0 || value > 500) return null;

  const hasDecreaseCue = /下调|下降|降低|降价|减少|调低/.test(compact);
  if (hasDecreaseCue) {
    const multiplier = 1 - value / 100;
    return multiplier > 0 ? multiplier : null;
  }

  const hasIncreaseCue = /上调|上涨|提高|升高|加价|增加|调高/.test(compact);
  if (hasIncreaseCue) return normalizeExplicitMultiplier(1 + value / 100);

  return value / 100;
}

export function readPriceMultiplierArgument(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  if (numeric <= 5) return numeric;
  return null;
}

export function inferPriceMultiplierFromText(text: string): number | null {
  const compact = text.replace(/\s+/g, '');
  const relativePercent = inferRelativePercentMultiplier(compact);
  if (relativePercent !== null) return relativePercent;

  const chineseDecimalFold = /([一二两三四五六七八九])点([一二两三四五六七八九])折/.exec(compact);
  if (chineseDecimalFold?.[1] && chineseDecimalFold[2]) {
    const integer = chineseDigitValue(chineseDecimalFold[1]);
    const decimal = chineseDigitValue(chineseDecimalFold[2]);
    if (integer !== null && decimal !== null) return (integer + decimal / 10) / 10;
  }

  const chineseFold = /([一二两三四五六七八九])折/.exec(compact);
  if (chineseFold?.[1]) {
    const value = chineseDigitValue(chineseFold[1]);
    if (value !== null) return value / 10;
  }

  const numericFold = /(\d+(?:\.\d+)?)折/.exec(compact);
  if (numericFold?.[1]) {
    const value = Number(numericFold[1]);
    if (Number.isFinite(value) && value > 0 && value <= 10) return value / 10;
  }

  const multiplier = /(\d+(?:\.\d+)?)(?:倍|x|X)/.exec(compact);
  if (multiplier?.[1]) return normalizeExplicitMultiplier(Number(multiplier[1]));

  const contextual = /(?:整体调价|整体改价|整体价格|所有价格|全部价格|调价|改价|倍率|倍数|乘以|乘)(?:为|到|成)?(\d+(?:\.\d+)?)/.exec(compact);
  if (contextual?.[1]) return normalizeExplicitMultiplier(Number(contextual[1]));

  return null;
}
