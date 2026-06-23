import { canonicalProductShortName } from '../publicTraffic/productDisplayName.js';
import type { LinkRegistryEntry } from './types.js';

const KNOWN_BRAND_PREFIXES = [
  /^insta360\s+/iu,
  /^影石\s+/u,
  /^(?:大疆|dji)\s+/iu,
  /^osmo\s+/iu,
  /^(?:苹果|apple)\s+/iu,
  /^iphone\s+/iu,
  /^ipad\s+/iu,
  /^(?:佳能|canon)\s+/iu,
  /^(?:索尼|sony)\s+/iu,
  /^(?:富士|fujifilm)\s+/iu,
  /^(?:尼康|nikon)\s+/iu,
  /^(?:松下|panasonic)\s+/iu,
  /^vivo\s+/iu,
];

export interface NormalizedAlias {
  raw: string;
  canonical: string;
  normalized: string;
  compact: string;
  brandless: string;
}

function normalizeWhitespace(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function normalizeWords(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compact(value: string): string {
  return normalizeWords(value).replace(/\s+/g, '');
}

function stripKnownBrandPrefix(value: string): string {
  let next = normalizeWords(value);
  for (const pattern of KNOWN_BRAND_PREFIXES) {
    next = next.replace(pattern, '');
  }
  return next.trim();
}

export function normalizeAlias(value: string): NormalizedAlias | null {
  const raw = normalizeWhitespace(value);
  if (!raw) return null;
  const canonical = normalizeWhitespace(canonicalProductShortName(raw) || raw);
  const normalized = normalizeWords(canonical);
  const compactValue = compact(canonical);
  const brandless = compact(stripKnownBrandPrefix(canonical));
  if (!normalized || !compactValue) return null;
  return { raw, canonical, normalized, compact: compactValue, brandless };
}

function addAlias(target: Set<string>, value: string | undefined): void {
  const normalized = normalizeAlias(value ?? '');
  if (!normalized) return;
  target.add(normalized.raw);
  target.add(normalized.canonical);
}

export function collectEntryAliases(entry: LinkRegistryEntry): string[] {
  const values = new Set<string>();
  addAlias(values, entry.productName);
  addAlias(values, entry.shortName);
  for (const alias of entry.aliases ?? []) addAlias(values, alias);
  return [...values];
}

export function aliasGroupKey(entry: LinkRegistryEntry): string {
  return entry.sameSkuGroupId?.trim() || `entry:${entry.internalProductId.trim()}`;
}

export function aliasDisplayLabel(entry: LinkRegistryEntry): string {
  return entry.shortName?.trim() || entry.productName?.trim() || entry.internalProductId;
}
