import { aliasGroupKey, collectEntryAliases, normalizeAlias } from './alias.js';
import { createLinkRegistryQuery, type SameSkuGroupConfidence } from './queryRegistry.js';
import type { LinkRegistryEntry, LinkRegistryStatus } from './types.js';
import type { LinkRegistryOverrideRisk } from './overrides.js';

export type LinkRegistryAuditRiskType = LinkRegistryOverrideRisk['type'] | 'sample_insufficient' | 'classification_unknown' | 'alias_duplicate_hit' | 'removed_link_returned_in_active_query' | 'platform_id_mapping_missing' | 'mixed_product_type' | 'promo_title_slug_leak' | 'group_classification_missing';

export interface LinkRegistryAuditRisk {
  type: LinkRegistryAuditRiskType;
  message: string;
  internalProductId?: string;
  sameSkuGroupId?: string;
  shortName?: string;
}

export interface LinkRegistryStatusCounts {
  active: number;
  removed: number;
  unknown: number;
  total: number;
}

export interface LinkRegistrySameSkuGroupAudit extends LinkRegistryStatusCounts {
  sameSkuGroupId: string;
  entries: LinkRegistryEntry[];
  sampleSize: number;
  sampleInsufficient: boolean;
  confidence: SameSkuGroupConfidence;
  manual: boolean;
  risks: LinkRegistryAuditRisk[];
}

export interface LinkRegistryProductTypeAudit extends LinkRegistryStatusCounts {
  productType: string;
  sameSkuGroups: LinkRegistrySameSkuGroupAudit[];
  classificationUnknownCount: number;
  sampleInsufficientCount: number;
}

export interface LinkRegistryCategoryAudit extends LinkRegistryStatusCounts {
  categoryId: string;
  categoryName?: string;
  productTypes: LinkRegistryProductTypeAudit[];
}

export interface LinkRegistryAudit extends LinkRegistryStatusCounts {
  categories: LinkRegistryCategoryAudit[];
  unknownEntries: LinkRegistryEntry[];
  unclassifiedCount: number;
  sameSkuGroups: LinkRegistrySameSkuGroupAudit[];
  risks: LinkRegistryAuditRisk[];
}

function emptyCounts(): LinkRegistryStatusCounts {
  return { active: 0, removed: 0, unknown: 0, total: 0 };
}

function addStatus(counts: LinkRegistryStatusCounts, status: LinkRegistryStatus): void {
  counts[status] += 1;
  counts.total += 1;
}

function countsFor(entries: LinkRegistryEntry[]): LinkRegistryStatusCounts {
  const counts = emptyCounts();
  for (const entry of entries) addStatus(counts, entry.status);
  return counts;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right);
}

function categoryKey(entry: LinkRegistryEntry): string {
  return entry.categoryId?.trim() || 'unknown';
}

function productTypeKey(entry: LinkRegistryEntry): string {
  return entry.productType?.trim() || 'unknown';
}

function groupedBy<T>(items: T[], keyFor: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

function sameSkuGroupIds(entries: LinkRegistryEntry[]): string[] {
  return [...new Set(entries.map((entry) => entry.sameSkuGroupId?.trim()).filter((value): value is string => !!value))].sort(compareText);
}

function distinctNonEmptyValues(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].sort(compareText);
}

function isPromoTitleSlugLeak(sameSkuGroupId: string): boolean {
  const trimmed = sameSkuGroupId.trim();
  if (!trimmed) return false;
  const hasChinese = /\p{Script=Han}/u.test(trimmed);
  const hasMarketingSeparator = /[-_]/.test(trimmed);
  return hasChinese && hasMarketingSeparator && trimmed.length >= 24;
}

function hasUsableGroupLevelClassificationPair(entry: LinkRegistryEntry): boolean {
  return Boolean(entry.categoryId?.trim() && entry.productType?.trim());
}

function groupLevelClassificationMissing(entries: LinkRegistryEntry[]): boolean {
  return !entries.some(hasUsableGroupLevelClassificationPair);
}

function governanceRisksForSameSkuGroup(entries: LinkRegistryEntry[], sameSkuGroupId: string): LinkRegistryAuditRisk[] {
  const productTypes = distinctNonEmptyValues(entries.map((entry) => entry.productType));
  const risks: LinkRegistryAuditRisk[] = [];
  if (productTypes.length > 1) {
    risks.push({
      type: 'mixed_product_type',
      message: `Same sku group ${sameSkuGroupId} mixes productType values: ${productTypes.join(', ')}`,
      sameSkuGroupId,
    });
  }
  if (isPromoTitleSlugLeak(sameSkuGroupId)) {
    risks.push({
      type: 'promo_title_slug_leak',
      message: `Same sku group ${sameSkuGroupId} looks like leaked promo-title slug text`,
      sameSkuGroupId,
    });
  }
  if (groupLevelClassificationMissing(entries)) {
    risks.push({
      type: 'group_classification_missing',
      message: `Same sku group ${sameSkuGroupId} is missing group-level classification`,
      sameSkuGroupId,
    });
  }
  return risks;
}

function buildSameSkuGroupAudit(entries: LinkRegistryEntry[], sameSkuGroupId: string): LinkRegistrySameSkuGroupAudit {
  const result = createLinkRegistryQuery(entries).bySameSkuGroup(sameSkuGroupId);
  const counts = countsFor(result.entries);
  const risks: LinkRegistryAuditRisk[] = [
    ...governanceRisksForSameSkuGroup(result.entries, sameSkuGroupId),
  ];
  if (result.sampleInsufficient) risks.push({ type: 'sample_insufficient', message: `Same sku group ${sameSkuGroupId} has ${result.sampleSize} entries`, sameSkuGroupId });
  return {
    sameSkuGroupId: result.sameSkuGroupId,
    entries: result.entries,
    sampleSize: result.sampleSize,
    sampleInsufficient: result.sampleInsufficient,
    confidence: result.confidence,
    manual: result.entries.some((entry) => entry.classificationSource === 'manual_override' || entry.source.includes('link_registry_override')),
    risks,
    ...counts,
  };
}

function buildProductTypeAudit(allEntries: LinkRegistryEntry[], productType: string, entries: LinkRegistryEntry[]): LinkRegistryProductTypeAudit {
  const counts = countsFor(entries);
  const sameSkuGroups = sameSkuGroupIds(entries).map((sameSkuGroupId) => buildSameSkuGroupAudit(allEntries, sameSkuGroupId));
  return {
    productType,
    sameSkuGroups,
    classificationUnknownCount: entries.filter((entry) => !entry.categoryId || !entry.productType).length,
    sampleInsufficientCount: sameSkuGroups.filter((group) => group.sampleInsufficient).length,
    ...counts,
  };
}

function buildCategoryAudit(allEntries: LinkRegistryEntry[], categoryId: string, entries: LinkRegistryEntry[]): LinkRegistryCategoryAudit {
  const counts = countsFor(entries);
  const productTypes = [...groupedBy(entries, productTypeKey).entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([productType, productEntries]) => buildProductTypeAudit(allEntries, productType, productEntries));
  const categoryName = entries.find((entry) => entry.categoryName?.trim())?.categoryName?.trim();
  return { categoryId, ...(categoryName ? { categoryName } : {}), productTypes, ...counts };
}

function unknownClassificationRisks(entries: LinkRegistryEntry[]): LinkRegistryAuditRisk[] {
  return entries
    .filter((entry) => !entry.categoryId || !entry.productType)
    .map((entry) => ({ type: 'classification_unknown', message: `Entry ${entry.internalProductId} has no complete category/productType classification`, internalProductId: entry.internalProductId }));
}

function aliasDuplicateRisks(entries: LinkRegistryEntry[]): LinkRegistryAuditRisk[] {
  const aliasToGroups = new Map<string, Set<string>>();
  const aliasDisplay = new Map<string, string>();
  for (const entry of entries) {
    const groupKey = aliasGroupKey(entry);
    for (const alias of collectEntryAliases(entry)) {
      const normalized = normalizeAlias(alias);
      if (!normalized || normalized.compact.length < 4) continue;
      const groups = aliasToGroups.get(normalized.compact) ?? new Set<string>();
      groups.add(groupKey);
      aliasToGroups.set(normalized.compact, groups);
      if (!aliasDisplay.has(normalized.compact)) aliasDisplay.set(normalized.compact, alias);
    }
  }
  return [...aliasToGroups.entries()]
    .filter(([, groups]) => groups.size > 1)
    .map(([aliasKey]) => ({
      type: 'alias_duplicate_hit',
      message: `Alias resolves to multiple groups: ${aliasDisplay.get(aliasKey) ?? aliasKey}`,
      shortName: aliasDisplay.get(aliasKey) ?? aliasKey,
    }));
}

function mappingMissingRisks(entries: LinkRegistryEntry[]): LinkRegistryAuditRisk[] {
  return entries
    .filter((entry) => !entry.platformProductId?.trim())
    .map((entry) => ({
      type: 'platform_id_mapping_missing',
      message: `Entry ${entry.internalProductId} is missing platformProductId mapping`,
      internalProductId: entry.internalProductId,
    }));
}

function activeQueryLeakRisks(entries: LinkRegistryEntry[]): LinkRegistryAuditRisk[] {
  const query = createLinkRegistryQuery(entries);
  return sameSkuGroupIds(entries).flatMap((sameSkuGroupId) => {
    const leaked = query.listBySameSkuGroup(sameSkuGroupId).filter((entry) => entry.status !== 'active');
    return leaked.map((entry) => ({
      type: 'removed_link_returned_in_active_query' as const,
      message: `Active query for ${sameSkuGroupId} returned non-active entry ${entry.internalProductId}`,
      sameSkuGroupId,
      internalProductId: entry.internalProductId,
    }));
  });
}

function overrideRiskToAuditRisk(risk: LinkRegistryOverrideRisk): LinkRegistryAuditRisk {
  return { type: risk.type, message: risk.message, ...(risk.internalProductId ? { internalProductId: risk.internalProductId } : {}), ...(risk.shortName ? { shortName: risk.shortName } : {}) };
}

export function buildLinkRegistryAudit(entries: LinkRegistryEntry[], overrideRisks: LinkRegistryOverrideRisk[] = []): LinkRegistryAudit {
  const counts = countsFor(entries);
  const categories = [...groupedBy(entries, categoryKey).entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([categoryId, categoryEntries]) => buildCategoryAudit(entries, categoryId, categoryEntries));
  const sameSkuGroups = sameSkuGroupIds(entries).map((sameSkuGroupId) => buildSameSkuGroupAudit(entries, sameSkuGroupId));
  const risks = [
    ...overrideRisks.map(overrideRiskToAuditRisk),
    ...unknownClassificationRisks(entries),
    ...mappingMissingRisks(entries),
    ...aliasDuplicateRisks(entries),
    ...activeQueryLeakRisks(entries),
    ...sameSkuGroups.flatMap((group) => group.risks),
  ];
  const unknownEntries = entries.filter((entry) => !entry.categoryId || !entry.productType);
  return {
    categories,
    unknownEntries,
    unclassifiedCount: unknownEntries.length,
    sameSkuGroups,
    risks,
    ...counts,
  };
}
