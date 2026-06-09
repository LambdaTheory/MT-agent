const PLATFORM_ID_PATTERN = /\b(20\d{20,})\b/;

export function extractProductIdFromInfo(text: string): string | null {
  const match = text.replace(/\s+/g, ' ').trim().match(PLATFORM_ID_PATTERN);
  return match ? match[1] : null;
}
