const PLATFORM_ID_PATTERN = /\b(20\d{20,})\b/;
const ID_BEFORE_PRICE_PATTERN = /(?:ID|商品ID|平台商品ID)\s*[:：]?\s*(20\d{21,})(?=\.\d{1,2}\s*~)/i;

export function extractProductIdFromInfo(text: string): string | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const priceAdjacentMatch = normalized.match(ID_BEFORE_PRICE_PATTERN);
  if (priceAdjacentMatch?.[1]) {
    return priceAdjacentMatch[1].slice(0, -1);
  }

  const match = normalized.match(PLATFORM_ID_PATTERN);
  return match ? match[1] : null;
}
