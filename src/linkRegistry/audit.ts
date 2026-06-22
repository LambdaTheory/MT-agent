import { createLinkRegistryQuery, type SameSkuGroupConfidence } from './queryRegistry.js';
import type { LinkRegistryEntry, LinkRegistryStatus } from './types.js';
import type { LinkRegistryOverrideRisk } from './overrides.js';

export type LinkRegistryAuditRiskType = LinkRegistryOverrideRisk['type'] | 'sample_insufficient' | 'classification_unknown';

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

function buildSameSkuGroupAudit(entries: LinkRegistryEntry[], sameSkuGroupId: string): LinkRegistrySameSkuGroupAudit {
  const result = createLinkRegistryQuery(entries).bySameSkuGroup(sameSkuGroupId);
  const counts = countsFor(result.entries);
  const risks: LinkRegistryAuditRisk[] = [];
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
    ...sameSkuGroups.flatMap((group) => group.risks),
  ];
  return {
    categories,
    unknownEntries: entries.filter((entry) => !entry.categoryId || !entry.productType),
    sameSkuGroups,
    risks,
    ...counts,
  };
}
