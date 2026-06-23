import type { LinkRegistryEntry, LinkRegistrySource, LinkRegistryStatus } from './types.js';

export interface LinkRegistryEntryOverride {
  internalProductId: string;
  productName?: string;
  categoryId?: string;
  categoryName?: string;
  productType?: string;
  shortName?: string;
  aliases?: string[];
  sameSkuGroupId?: string;
  status?: LinkRegistryStatus;
  confidence?: number;
  reason?: string;
  maintainer?: string;
  updatedAt?: string;
  disabled?: boolean;
}

export interface LinkRegistryShortNameRule {
  shortName: string;
  productName?: string;
  categoryId?: string;
  categoryName?: string;
  productType?: string;
  aliases?: string[];
  sameSkuGroupId?: string;
  confidence?: number;
  reason?: string;
  maintainer?: string;
  updatedAt?: string;
  disabled?: boolean;
}

export interface LinkRegistrySameSkuGroupAliasRule {
  sameSkuGroupId: string;
  aliases: string[];
  reason?: string;
  maintainer?: string;
  updatedAt?: string;
  disabled?: boolean;
}

export interface LinkRegistryOverrides {
  version: 1;
  entries?: LinkRegistryEntryOverride[];
  shortNameRules?: LinkRegistryShortNameRule[];
  sameSkuGroupAliasRules?: LinkRegistrySameSkuGroupAliasRule[];
}

export type LinkRegistryOverrideRiskType = 'duplicate_manual_assignment' | 'duplicate_short_name_rule' | 'duplicate_same_sku_group_alias_rule' | 'unknown_internal_product_id' | 'unknown_same_sku_group_id' | 'malformed_override' | 'disabled_override';

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

type ClassificationPatch = Partial<Pick<LinkRegistryEntry, 'productName' | 'categoryId' | 'categoryName' | 'productType' | 'shortName' | 'aliases' | 'sameSkuGroupId' | 'status' | 'confidence' | 'updatedAt'>>;

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

function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid ${key}: expected finite number`);
  return value;
}

function optionalStatus(record: Record<string, unknown>, key: string): LinkRegistryStatus | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (value !== 'active' && value !== 'removed' && value !== 'unknown') throw new Error(`Invalid ${key}: expected LinkRegistryStatus`);
  return value;
}

function optionalStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`Invalid ${key}: expected string[]`);
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
    productName: optionalString(value, 'productName'),
    categoryId: optionalString(value, 'categoryId'),
    categoryName: optionalString(value, 'categoryName'),
    productType: optionalString(value, 'productType'),
    shortName: optionalString(value, 'shortName'),
    aliases: optionalStringArray(value, 'aliases'),
    sameSkuGroupId,
    status: optionalStatus(value, 'status'),
    confidence: optionalNumber(value, 'confidence'),
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
    productName: optionalString(value, 'productName'),
    categoryId: optionalString(value, 'categoryId'),
    categoryName: optionalString(value, 'categoryName'),
    productType: optionalString(value, 'productType'),
    aliases: optionalStringArray(value, 'aliases'),
    sameSkuGroupId,
    confidence: optionalNumber(value, 'confidence'),
    reason: optionalString(value, 'reason'),
    maintainer: optionalString(value, 'maintainer'),
    updatedAt: optionalString(value, 'updatedAt'),
    disabled: optionalBoolean(value, 'disabled'),
  };
}

function parseSameSkuGroupAliasRule(value: unknown): LinkRegistrySameSkuGroupAliasRule {
  if (!isRecord(value)) throw new Error('Invalid sameSkuGroup alias rule: expected object');
  const sameSkuGroupId = optionalString(value, 'sameSkuGroupId')?.trim();
  if (!sameSkuGroupId || !validSameSkuGroupId(sameSkuGroupId)) throw new Error('Invalid sameSkuGroup alias rule sameSkuGroupId');
  const aliases = optionalStringArray(value, 'aliases')?.map((item) => item.trim()).filter(Boolean) ?? [];
  if (aliases.length === 0) throw new Error('Invalid sameSkuGroup alias rule aliases');
  return {
    sameSkuGroupId,
    aliases,
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
    sameSkuGroupAliasRules: optionalArray(value, 'sameSkuGroupAliasRules')?.map(parseSameSkuGroupAliasRule),
  };
}

function sourceWith(entry: LinkRegistryEntry, source: LinkRegistrySource): LinkRegistrySource[] {
  return entry.source.includes(source) ? entry.source : [...entry.source, source].sort();
}

function patchFrom(value: ClassificationPatch): ClassificationPatch {
  return {
    productName: trimmed(value.productName),
    categoryId: trimmed(value.categoryId),
    categoryName: trimmed(value.categoryName),
    productType: trimmed(value.productType),
    shortName: trimmed(value.shortName),
    aliases: value.aliases?.map((item) => item.trim()).filter(Boolean),
    sameSkuGroupId: trimmed(value.sameSkuGroupId),
    status: value.status,
    confidence: value.confidence,
    updatedAt: trimmed(value.updatedAt),
  };
}

function applyPatch(entry: LinkRegistryEntry, patch: ClassificationPatch, source: LinkRegistrySource): LinkRegistryEntry {
  const nextPatch = patchFrom(patch);
  const aliases = [...new Set([...(entry.aliases ?? []), ...(nextPatch.aliases ?? [])].map((item) => item.trim()).filter(Boolean))].sort();
  return {
    ...entry,
    ...(nextPatch.productName ? { productName: nextPatch.productName } : {}),
    ...(nextPatch.categoryId ? { categoryId: nextPatch.categoryId } : {}),
    ...(nextPatch.categoryName ? { categoryName: nextPatch.categoryName } : {}),
    ...(nextPatch.productType ? { productType: nextPatch.productType } : {}),
    ...(nextPatch.shortName ? { shortName: nextPatch.shortName } : {}),
    ...(aliases.length > 0 ? { aliases } : {}),
    ...(nextPatch.sameSkuGroupId ? { sameSkuGroupId: nextPatch.sameSkuGroupId } : {}),
    ...(nextPatch.status ? { status: nextPatch.status } : {}),
    ...(nextPatch.confidence !== undefined ? { confidence: nextPatch.confidence } : {}),
    ...(nextPatch.updatedAt ? { updatedAt: nextPatch.updatedAt } : {}),
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
  for (const rule of overrides.sameSkuGroupAliasRules ?? []) {
    if (rule.disabled === true) risks.push({ type: 'disabled_override', message: `Disabled sameSkuGroup alias rule ignored: ${rule.sameSkuGroupId}`, shortName: rule.sameSkuGroupId });
  }
}

function enabledEntryOverrides(overrides: LinkRegistryOverrides): LinkRegistryEntryOverride[] {
  return (overrides.entries ?? []).filter((item) => item.disabled !== true);
}

function enabledShortNameRules(overrides: LinkRegistryOverrides): LinkRegistryShortNameRule[] {
  return (overrides.shortNameRules ?? []).filter((item) => item.disabled !== true);
}

function enabledSameSkuGroupAliasRules(overrides: LinkRegistryOverrides): LinkRegistrySameSkuGroupAliasRule[] {
  return (overrides.sameSkuGroupAliasRules ?? []).filter((item) => item.disabled !== true);
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

function assertUniqueSameSkuGroupAliasRules(rules: LinkRegistrySameSkuGroupAliasRule[]): void {
  const seen = new Set<string>();
  for (const rule of rules) {
    const key = rule.sameSkuGroupId.trim();
    if (seen.has(key)) throw new Error(`Duplicate sameSkuGroup alias rule for ${key}`);
    seen.add(key);
  }
}

export function applyLinkRegistryOverrides(entries: LinkRegistryEntry[], overrides: LinkRegistryOverrides): ApplyLinkRegistryOverridesResult {
  const risks: LinkRegistryOverrideRisk[] = [];
  addDisabledRisks(overrides, risks);
  const entryOverrides = enabledEntryOverrides(overrides);
  const shortNameRules = enabledShortNameRules(overrides);
  const sameSkuGroupAliasRules = enabledSameSkuGroupAliasRules(overrides);
  assertUniqueEntryOverrides(entryOverrides);
  assertUniqueShortNameRules(shortNameRules);
  assertUniqueSameSkuGroupAliasRules(sameSkuGroupAliasRules);

  const overrideById = new Map(entryOverrides.map((override) => [override.internalProductId.trim(), override]));
  const ruleByShortName = new Map(shortNameRules.map((rule) => [rule.shortName.trim(), rule]));
  const matchedOverrideIds = new Set<string>();

  const patchedEntries = entries.map((entry) => {
    const override = overrideById.get(entry.internalProductId.trim());
    if (override) {
      matchedOverrideIds.add(override.internalProductId.trim());
      return applyPatch(entry, override, 'link_registry_override');
    }

    const shortName = entry.shortName?.trim();
    const rule = shortName ? ruleByShortName.get(shortName) : undefined;
    return rule ? applyPatch(entry, rule, 'short_name_rule') : entry;
  });

  const matchedSameSkuGroups = new Set<string>();
  const nextEntries = patchedEntries.map((entry) => {
    const sameSkuGroupId = entry.sameSkuGroupId?.trim();
    if (!sameSkuGroupId) return entry;
    const rule = sameSkuGroupAliasRules.find((item) => item.sameSkuGroupId.trim() === sameSkuGroupId);
    if (!rule) return entry;
    matchedSameSkuGroups.add(sameSkuGroupId);
    return {
      ...entry,
      aliases: [...new Set([...(entry.aliases ?? []), ...rule.aliases].map((item) => item.trim()).filter(Boolean))].sort(),
      ...(rule.updatedAt ? { updatedAt: rule.updatedAt } : {}),
      source: sourceWith(entry, 'same_sku_group_alias_rule'),
    };
  });

  for (const override of entryOverrides) {
    if (!matchedOverrideIds.has(override.internalProductId.trim())) risks.push({ type: 'unknown_internal_product_id', message: `Override target not found: ${override.internalProductId}`, internalProductId: override.internalProductId });
  }
  for (const rule of sameSkuGroupAliasRules) {
    if (!matchedSameSkuGroups.has(rule.sameSkuGroupId.trim())) risks.push({ type: 'unknown_same_sku_group_id', message: `Same sku group alias rule target not found: ${rule.sameSkuGroupId}`, internalProductId: undefined, shortName: rule.sameSkuGroupId });
  }

  return { entries: nextEntries, risks };
}
