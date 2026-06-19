import type { LinkRegistryEntry, LinkRegistrySource } from './types.js';

export interface LinkRegistryEntryOverride {
  internalProductId: string;
  categoryId?: string;
  categoryName?: string;
  productType?: string;
  shortName?: string;
  sameSkuGroupId?: string;
  reason?: string;
  maintainer?: string;
  updatedAt?: string;
  disabled?: boolean;
}

export interface LinkRegistryShortNameRule {
  shortName: string;
  categoryId?: string;
  categoryName?: string;
  productType?: string;
  sameSkuGroupId?: string;
  reason?: string;
  maintainer?: string;
  updatedAt?: string;
  disabled?: boolean;
}

export interface LinkRegistryOverrides {
  version: 1;
  entries?: LinkRegistryEntryOverride[];
  shortNameRules?: LinkRegistryShortNameRule[];
}

export type LinkRegistryOverrideRiskType = 'duplicate_manual_assignment' | 'duplicate_short_name_rule' | 'unknown_internal_product_id' | 'malformed_override' | 'disabled_override';

export interface LinkRegistryOverrideRisk {
  type: LinkRegistryOverrideRiskType;
  message: string;
  internalProductId?: string;
  shortName?: string;
}

export interface ApplyLinkRegistryOverridesResult {
  entries: LinkRegistryEntry[];
  risks: LinkRegistryOverrideRisk[];
}

type ClassificationPatch = Pick<LinkRegistryEntry, 'categoryId' | 'categoryName' | 'productType' | 'shortName' | 'sameSkuGroupId'>;

function trimmed(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

function validInternalProductId(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

function validSameSkuGroupId(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{1,63}$/.test(value.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`Invalid ${key}: expected string`);
  return value;
}

function optionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`Invalid ${key}: expected boolean`);
  return value;
}

function validateSameSkuGroupId(value: string | undefined): void {
  if (value && !validSameSkuGroupId(value)) throw new Error(`Invalid sameSkuGroupId: ${value}`);
}

function parseEntryOverride(value: unknown): LinkRegistryEntryOverride {
  if (!isRecord(value)) throw new Error('Invalid entry override: expected object');
  const internalProductId = optionalString(value, 'internalProductId')?.trim();
  if (!internalProductId || !validInternalProductId(internalProductId)) throw new Error('Invalid entry override internalProductId');
  const sameSkuGroupId = optionalString(value, 'sameSkuGroupId');
  validateSameSkuGroupId(sameSkuGroupId);
  return {
    internalProductId,
    categoryId: optionalString(value, 'categoryId'),
    categoryName: optionalString(value, 'categoryName'),
    productType: optionalString(value, 'productType'),
    shortName: optionalString(value, 'shortName'),
    sameSkuGroupId,
    reason: optionalString(value, 'reason'),
    maintainer: optionalString(value, 'maintainer'),
    updatedAt: optionalString(value, 'updatedAt'),
    disabled: optionalBoolean(value, 'disabled'),
  };
}

function parseShortNameRule(value: unknown): LinkRegistryShortNameRule {
  if (!isRecord(value)) throw new Error('Invalid shortName rule: expected object');
  const shortName = optionalString(value, 'shortName')?.trim();
  if (!shortName) throw new Error('Invalid shortName rule shortName');
  const sameSkuGroupId = optionalString(value, 'sameSkuGroupId');
  validateSameSkuGroupId(sameSkuGroupId);
  return {
    shortName,
    categoryId: optionalString(value, 'categoryId'),
    categoryName: optionalString(value, 'categoryName'),
    productType: optionalString(value, 'productType'),
    sameSkuGroupId,
    reason: optionalString(value, 'reason'),
    maintainer: optionalString(value, 'maintainer'),
    updatedAt: optionalString(value, 'updatedAt'),
    disabled: optionalBoolean(value, 'disabled'),
  };
}

function optionalArray(record: Record<string, unknown>, key: string): unknown[] | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`Invalid ${key}: expected array`);
  return value;
}

export function parseLinkRegistryOverrides(value: unknown): LinkRegistryOverrides {
  if (!isRecord(value)) throw new Error('Link registry overrides must be a JSON object');
  if (value.version !== 1) throw new Error('Link registry overrides version must be 1');
  return {
    version: 1,
    entries: optionalArray(value, 'entries')?.map(parseEntryOverride),
    shortNameRules: optionalArray(value, 'shortNameRules')?.map(parseShortNameRule),
  };
}

function sourceWith(entry: LinkRegistryEntry, source: LinkRegistrySource): LinkRegistrySource[] {
  return entry.source.includes(source) ? entry.source : [...entry.source, source].sort();
}

function patchFrom(value: ClassificationPatch): ClassificationPatch {
  return {
    categoryId: trimmed(value.categoryId),
    categoryName: trimmed(value.categoryName),
    productType: trimmed(value.productType),
    shortName: trimmed(value.shortName),
    sameSkuGroupId: trimmed(value.sameSkuGroupId),
  };
}

function applyPatch(entry: LinkRegistryEntry, patch: ClassificationPatch, source: LinkRegistrySource): LinkRegistryEntry {
  const nextPatch = patchFrom(patch);
  return {
    ...entry,
    ...(nextPatch.categoryId ? { categoryId: nextPatch.categoryId } : {}),
    ...(nextPatch.categoryName ? { categoryName: nextPatch.categoryName } : {}),
    ...(nextPatch.productType ? { productType: nextPatch.productType } : {}),
    ...(nextPatch.shortName ? { shortName: nextPatch.shortName } : {}),
    ...(nextPatch.sameSkuGroupId ? { sameSkuGroupId: nextPatch.sameSkuGroupId } : {}),
    classificationSource: source === 'link_registry_override' ? 'manual_override' : 'short_name_rule',
    source: sourceWith(entry, source),
  };
}

function addDisabledRisks(overrides: LinkRegistryOverrides, risks: LinkRegistryOverrideRisk[]): void {
  for (const override of overrides.entries ?? []) {
    if (override.disabled === true) risks.push({ type: 'disabled_override', message: `Disabled entry override ignored: ${override.internalProductId}`, internalProductId: override.internalProductId });
  }
  for (const rule of overrides.shortNameRules ?? []) {
    if (rule.disabled === true) risks.push({ type: 'disabled_override', message: `Disabled shortName rule ignored: ${rule.shortName}`, shortName: rule.shortName });
  }
}

function enabledEntryOverrides(overrides: LinkRegistryOverrides): LinkRegistryEntryOverride[] {
  return (overrides.entries ?? []).filter((item) => item.disabled !== true);
}

function enabledShortNameRules(overrides: LinkRegistryOverrides): LinkRegistryShortNameRule[] {
  return (overrides.shortNameRules ?? []).filter((item) => item.disabled !== true);
}

function assertUniqueEntryOverrides(overrides: LinkRegistryEntryOverride[]): void {
  const seen = new Set<string>();
  for (const override of overrides) {
    if (seen.has(override.internalProductId)) throw new Error(`Duplicate manual override for internalProductId ${override.internalProductId}`);
    seen.add(override.internalProductId);
  }
}

function assertUniqueShortNameRules(rules: LinkRegistryShortNameRule[]): void {
  const seen = new Set<string>();
  for (const rule of rules) {
    const key = rule.shortName.trim();
    if (seen.has(key)) throw new Error(`Duplicate shortName rule for ${key}`);
    seen.add(key);
  }
}

export function applyLinkRegistryOverrides(entries: LinkRegistryEntry[], overrides: LinkRegistryOverrides): ApplyLinkRegistryOverridesResult {
  const risks: LinkRegistryOverrideRisk[] = [];
  addDisabledRisks(overrides, risks);
  const entryOverrides = enabledEntryOverrides(overrides);
  const shortNameRules = enabledShortNameRules(overrides);
  assertUniqueEntryOverrides(entryOverrides);
  assertUniqueShortNameRules(shortNameRules);

  const overrideById = new Map(entryOverrides.map((override) => [override.internalProductId.trim(), override]));
  const ruleByShortName = new Map(shortNameRules.map((rule) => [rule.shortName.trim(), rule]));
  const matchedOverrideIds = new Set<string>();

  const nextEntries = entries.map((entry) => {
    const override = overrideById.get(entry.internalProductId.trim());
    if (override) {
      matchedOverrideIds.add(override.internalProductId.trim());
      return applyPatch(entry, override, 'link_registry_override');
    }

    const shortName = entry.shortName?.trim();
    const rule = shortName ? ruleByShortName.get(shortName) : undefined;
    return rule ? applyPatch(entry, rule, 'short_name_rule') : entry;
  });

  for (const override of entryOverrides) {
    if (!matchedOverrideIds.has(override.internalProductId.trim())) risks.push({ type: 'unknown_internal_product_id', message: `Override target not found: ${override.internalProductId}`, internalProductId: override.internalProductId });
  }

  return { entries: nextEntries, risks };
}
