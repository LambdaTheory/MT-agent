import { preferredShortNameForSameSkuGroup } from './buildRegistry.js';
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

export interface LinkRegistrySameSkuGroupRule {
  matchSameSkuGroupId: string;
  productName?: string;
  categoryId?: string;
  categoryName?: string;
  productType?: string;
  shortName?: string;
  aliases?: string[];
  sameSkuGroupId?: string;
  confidence?: number;
  reason?: string;
  maintainer?: string;
  updatedAt?: string;
  disabled?: boolean;
}

export const sameSkuGroupRules: ReadonlyArray<Pick<LinkRegistrySameSkuGroupRule, 'matchSameSkuGroupId' | 'sameSkuGroupId' | 'categoryId' | 'categoryName' | 'productType'>> = [
  {
    matchSameSkuGroupId: 'r50',
    sameSkuGroupId: 'canon-eos-r50',
    categoryId: 'camera',
    categoryName: '相机',
    productType: 'camera',
  },
  {
    matchSameSkuGroupId: 'canon-eos-r50',
    categoryId: 'camera',
    categoryName: '相机',
    productType: 'camera',
  },
  {
    matchSameSkuGroupId: 'ace-pro-2',
    sameSkuGroupId: 'insta360-ace-pro-2',
    categoryId: 'camera',
    categoryName: '运动相机',
    productType: 'action-camera',
  },
  {
    matchSameSkuGroupId: 'insta360-ace-pro-2',
    categoryId: 'camera',
    categoryName: '运动相机',
    productType: 'action-camera',
  },
  {
    matchSameSkuGroupId: 'vivo-x300-pro',
    categoryId: 'phone',
    categoryName: '手机',
    productType: 'smartphone',
  },
];

export interface LinkRegistryOverrides {
  version: 1;
  entries?: LinkRegistryEntryOverride[];
  shortNameRules?: LinkRegistryShortNameRule[];
  sameSkuGroupRules?: LinkRegistrySameSkuGroupRule[];
  sameSkuGroupAliasRules?: LinkRegistrySameSkuGroupAliasRule[];
}

export type LinkRegistryOverrideRiskType = 'duplicate_manual_assignment' | 'duplicate_short_name_rule' | 'duplicate_same_sku_group_rule' | 'duplicate_same_sku_group_alias_rule' | 'unknown_internal_product_id' | 'unknown_same_sku_group_id' | 'malformed_override' | 'disabled_override';

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

const MANUAL_SEED_CONFIDENCE = 0.6;

function trimmed(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

function validInternalProductId(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

function isPromoTitleSlug(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const hasChinese = /\p{Script=Han}/u.test(trimmed);
  const hasMarketingSeparator = /[-_]/.test(trimmed);
  return hasChinese && hasMarketingSeparator && trimmed.length >= 24;
}

/** Validates a canonical sameSkuGroupId (destination, not a remap source). Rejects promo-title slugs. */
function validSameSkuGroupId(value: string): boolean {
  const trimmed = value.trim();
  if (isPromoTitleSlug(trimmed)) return false;
  return /^[\p{Letter}\p{Number}][\p{Letter}\p{Number}\s_-]{1,63}$/u.test(trimmed);
}

/** Validates a matchSameSkuGroupId (remap source). Allows promo-title slugs so existing group remaps work. */
function validMatchSameSkuGroupId(value: string): boolean {
  return /^[\p{Letter}\p{Number}][\p{Letter}\p{Number}\s_-]{1,127}$/u.test(value.trim());
}

function normalizeKnownBrokenSameSkuGroupId(value: string): string {
  const trimmed = value.trim();
  if (/^vivo-.*2-35x.*$/iu.test(trimmed) && /钄|澧炶窛|绁炲櫒|�/u.test(trimmed)) return 'vivo-zeiss-telephoto-lens';
  if (/^fujifilm-instax-mini90/iu.test(trimmed)) return 'fujifilm-instax-mini-90';
  return trimmed;
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

function parseSameSkuGroupId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = normalizeKnownBrokenSameSkuGroupId(value);
  if (!validSameSkuGroupId(normalized)) throw new Error(`Invalid sameSkuGroupId: ${value}`);
  return normalized;
}

/** Parse a matchSameSkuGroupId (remap source): allows promo-title slugs so existing group remaps work. */
function parseMatchSameSkuGroupId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!validMatchSameSkuGroupId(trimmed)) throw new Error(`Invalid matchSameSkuGroupId: ${value}`);
  return trimmed;
}

function parseEntryOverride(value: unknown): LinkRegistryEntryOverride {
  if (!isRecord(value)) throw new Error('Invalid entry override: expected object');
  const internalProductId = optionalString(value, 'internalProductId')?.trim();
  if (!internalProductId || !validInternalProductId(internalProductId)) throw new Error('Invalid entry override internalProductId');
  const sameSkuGroupId = parseSameSkuGroupId(optionalString(value, 'sameSkuGroupId'));
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
  const sameSkuGroupId = parseSameSkuGroupId(optionalString(value, 'sameSkuGroupId'));
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
  const sameSkuGroupId = parseSameSkuGroupId(optionalString(value, 'sameSkuGroupId'));
  if (!sameSkuGroupId) throw new Error('Invalid sameSkuGroup alias rule sameSkuGroupId');
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

function parseSameSkuGroupRule(value: unknown): LinkRegistrySameSkuGroupRule {
  if (!isRecord(value)) throw new Error('Invalid sameSkuGroup rule: expected object');
  const matchSameSkuGroupId = parseMatchSameSkuGroupId(optionalString(value, 'matchSameSkuGroupId'));
  if (!matchSameSkuGroupId) throw new Error('Invalid sameSkuGroup rule matchSameSkuGroupId');
  const sameSkuGroupId = parseSameSkuGroupId(optionalString(value, 'sameSkuGroupId'));
  return {
    matchSameSkuGroupId,
    productName: optionalString(value, 'productName'),
    categoryId: optionalString(value, 'categoryId'),
    categoryName: optionalString(value, 'categoryName'),
    productType: optionalString(value, 'productType'),
    shortName: optionalString(value, 'shortName'),
    aliases: optionalStringArray(value, 'aliases'),
    sameSkuGroupId,
    confidence: optionalNumber(value, 'confidence'),
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
    sameSkuGroupRules: optionalArray(value, 'sameSkuGroupRules')?.map(parseSameSkuGroupRule),
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

function normalizedAliases(values: string[] | undefined): string[] | undefined {
  const aliases = [...new Set((values ?? []).map((item) => item.trim()).filter(Boolean))].sort();
  return aliases.length > 0 ? aliases : undefined;
}

function comparableShortName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^(?:佳能|富士|大疆|影石|索尼|尼康|松下)\s*/gu, '')
    .replace(/^vivo\s*/giu, '')
    .replace(/\binstax\b/giu, '')
    .replace(/\bmm\b/giu, '')
    .replace(/镜头/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '');
}

function normalizePreferredGroupShortNames(entries: LinkRegistryEntry[]): LinkRegistryEntry[] {
  return entries.map((entry) => {
    if (entry.classificationSource === 'manual_override') return entry;

    const sameSkuGroupId = entry.sameSkuGroupId?.trim();
    const currentShortName = entry.shortName?.trim();
    if (!sameSkuGroupId || !currentShortName) return entry;

    const preferredShortName = preferredShortNameForSameSkuGroup(sameSkuGroupId)?.trim();
    if (!preferredShortName || currentShortName === preferredShortName) return entry;
    if (comparableShortName(currentShortName) !== comparableShortName(preferredShortName)) return entry;

    return {
      ...entry,
      shortName: preferredShortName,
      aliases: normalizedAliases([...(entry.aliases ?? []), currentShortName, preferredShortName]),
    };
  });
}

function normalizedClassificationPatch(entry: LinkRegistryEntry): Partial<LinkRegistryEntry> | null {
  const key = [
    entry.sameSkuGroupId?.trim(),
    entry.shortName?.trim(),
    entry.productName?.trim(),
  ].filter(Boolean).join(' ').toLowerCase();

  if (!key) return null;
  if (/vivo-zeiss-telephoto-lens|vivo\s*蔡司增距镜|长焦增距镜/.test(key)) {
    return { categoryId: 'lens', categoryName: '\u955c\u5934', productType: 'lens-accessory' };
  }
  if (/dji-pocket-\d|pocket\s*\d/.test(key)) {
    return { categoryId: 'camera', categoryName: '\u76f8\u673a', productType: 'gimbal-camera' };
  }
  return null;
}

function normalizeKnownClassifications(entries: LinkRegistryEntry[]): LinkRegistryEntry[] {
  return entries.map((entry) => {
    const patch = normalizedClassificationPatch(entry);
    return patch ? { ...entry, ...patch } : entry;
  });
}

function compareInternalProductId(left: LinkRegistryEntry, right: LinkRegistryEntry): number {
  const leftNumber = Number(left.internalProductId);
  const rightNumber = Number(right.internalProductId);
  return leftNumber - rightNumber || left.internalProductId.localeCompare(right.internalProductId);
}

function canSeedEntryFromOverride(override: LinkRegistryEntryOverride): boolean {
  return Boolean(
    trimmed(override.productName)
    || trimmed(override.shortName)
    || trimmed(override.sameSkuGroupId),
  );
}

function seedEntryFromOverride(override: LinkRegistryEntryOverride): LinkRegistryEntry {
  const aliases = normalizedAliases(override.aliases);
  return {
    internalProductId: override.internalProductId.trim(),
    ...(trimmed(override.productName) ? { productName: trimmed(override.productName) } : {}),
    ...(trimmed(override.categoryId) ? { categoryId: trimmed(override.categoryId) } : {}),
    ...(trimmed(override.categoryName) ? { categoryName: trimmed(override.categoryName) } : {}),
    ...(trimmed(override.productType) ? { productType: trimmed(override.productType) } : {}),
    ...(trimmed(override.shortName) ? { shortName: trimmed(override.shortName) } : {}),
    ...(aliases ? { aliases } : {}),
    ...(trimmed(override.sameSkuGroupId) ? { sameSkuGroupId: trimmed(override.sameSkuGroupId) } : {}),
    status: override.status ?? 'unknown',
    confidence: override.confidence ?? MANUAL_SEED_CONFIDENCE,
    ...(trimmed(override.updatedAt) ? { updatedAt: trimmed(override.updatedAt) } : {}),
    classificationSource: 'manual_override',
    source: ['link_registry_override'],
  };
}

function applyPatch(entry: LinkRegistryEntry, patch: ClassificationPatch, source: LinkRegistrySource): LinkRegistryEntry {
  const nextPatch = patchFrom(patch);
  const aliases = normalizedAliases([...(entry.aliases ?? []), ...(nextPatch.aliases ?? [])]);
  return {
    ...entry,
    ...(nextPatch.productName ? { productName: nextPatch.productName } : {}),
    ...(nextPatch.categoryId ? { categoryId: nextPatch.categoryId } : {}),
    ...(nextPatch.categoryName ? { categoryName: nextPatch.categoryName } : {}),
    ...(nextPatch.productType ? { productType: nextPatch.productType } : {}),
    ...(nextPatch.shortName ? { shortName: nextPatch.shortName } : {}),
    ...(aliases ? { aliases } : {}),
    ...(nextPatch.sameSkuGroupId ? { sameSkuGroupId: nextPatch.sameSkuGroupId } : {}),
    ...(nextPatch.status ? { status: nextPatch.status } : {}),
    ...(nextPatch.confidence !== undefined ? { confidence: nextPatch.confidence } : {}),
    ...(nextPatch.updatedAt ? { updatedAt: nextPatch.updatedAt } : {}),
    classificationSource: source === 'short_name_rule' ? 'short_name_rule' : 'manual_override',
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
  for (const rule of overrides.sameSkuGroupRules ?? []) {
    if (rule.disabled === true) risks.push({ type: 'disabled_override', message: `Disabled sameSkuGroup rule ignored: ${rule.matchSameSkuGroupId}`, shortName: rule.matchSameSkuGroupId });
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

function enabledSameSkuGroupRules(overrides: LinkRegistryOverrides): LinkRegistrySameSkuGroupRule[] {
  return (overrides.sameSkuGroupRules ?? []).filter((item) => item.disabled !== true);
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

function assertUniqueSameSkuGroupRules(rules: LinkRegistrySameSkuGroupRule[]): void {
  const seen = new Set<string>();
  for (const rule of rules) {
    const key = rule.matchSameSkuGroupId.trim();
    if (seen.has(key)) throw new Error(`Duplicate sameSkuGroup rule for ${key}`);
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
  const sameSkuGroupRules = enabledSameSkuGroupRules(overrides);
  const sameSkuGroupAliasRules = enabledSameSkuGroupAliasRules(overrides);
  assertUniqueEntryOverrides(entryOverrides);
  assertUniqueShortNameRules(shortNameRules);
  assertUniqueSameSkuGroupRules(sameSkuGroupRules);
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

  const seededEntries = entryOverrides
    .filter((override) => !matchedOverrideIds.has(override.internalProductId.trim()))
    .flatMap((override) => {
      if (!canSeedEntryFromOverride(override)) return [];
      matchedOverrideIds.add(override.internalProductId.trim());
      return [seedEntryFromOverride(override)];
    });

  const matchedSameSkuGroups = new Set<string>();
  const patchedBySameSkuGroup = [...patchedEntries, ...seededEntries]
    .sort(compareInternalProductId)
    .map((entry) => {
      const sameSkuGroupId = entry.sameSkuGroupId?.trim();
      if (!sameSkuGroupId) return entry;
      const rule = sameSkuGroupRules.find((item) => item.matchSameSkuGroupId.trim() === sameSkuGroupId);
      if (!rule) return entry;
      matchedSameSkuGroups.add(sameSkuGroupId);
      return applyPatch(entry, rule, 'same_sku_group_rule');
    });

  const nextEntries = patchedBySameSkuGroup
    .sort(compareInternalProductId)
    .map((entry) => {
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
  for (const rule of sameSkuGroupRules) {
    if (!matchedSameSkuGroups.has(rule.matchSameSkuGroupId.trim())) risks.push({ type: 'unknown_same_sku_group_id', message: `Same sku group rule target not found: ${rule.matchSameSkuGroupId}`, internalProductId: undefined, shortName: rule.matchSameSkuGroupId });
  }
  for (const rule of sameSkuGroupAliasRules) {
    if (!matchedSameSkuGroups.has(rule.sameSkuGroupId.trim())) risks.push({ type: 'unknown_same_sku_group_id', message: `Same sku group alias rule target not found: ${rule.sameSkuGroupId}`, internalProductId: undefined, shortName: rule.sameSkuGroupId });
  }

  return { entries: normalizeKnownClassifications(normalizePreferredGroupShortNames(nextEntries)), risks };
}
