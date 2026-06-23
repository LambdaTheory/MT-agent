import { describe, expect, it } from 'vitest';
import { applyLinkRegistryOverrides, parseLinkRegistryOverrides } from '../src/linkRegistry/overrides.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';

const entries: LinkRegistryEntry[] = [
  { internalProductId: '701', platformProductId: 'platform-701', productName: 'Insta360 Ace Pro 2 Full Kit', shortName: 'Old short name', sameSkuGroupId: 'old-group', status: 'active', source: ['product_id_mapping'] },
  { internalProductId: '702', platformProductId: 'platform-702', productName: 'Canon SX70', shortName: 'Canon SX70', status: 'removed', source: ['product_name_map'] },
  { internalProductId: '703', platformProductId: 'platform-703', productName: 'Unknown item', shortName: 'Unknown item', status: 'unknown', source: ['product_id_mapping'] },
];

describe('link registry overrides', () => {
  it('applies manual entry overrides before existing same sku group fields', () => {
    const result = applyLinkRegistryOverrides(entries, {
      version: 1,
      entries: [{ internalProductId: '701', categoryId: 'camera', categoryName: '相机', productType: 'canon-sx', shortName: 'Canon SX70', aliases: ['Ace pro 2'], sameSkuGroupId: 'canon-sx70', updatedAt: '2026-06-23' }],
    });

    expect(result.entries[0]).toMatchObject({ categoryId: 'camera', categoryName: '相机', productType: 'canon-sx', shortName: 'Canon SX70', sameSkuGroupId: 'canon-sx70', classificationSource: 'manual_override', updatedAt: '2026-06-23' });
    expect(result.entries[0]?.aliases).toEqual(expect.arrayContaining(['Ace pro 2']));
    expect(result.entries[0].source).toContain('link_registry_override');
    expect(result.risks).toEqual([]);
  });

  it('ignores disabled overrides and keeps the original entry behavior', () => {
    const result = applyLinkRegistryOverrides(entries, {
      version: 1,
      entries: [{ internalProductId: '701', categoryId: 'camera', sameSkuGroupId: 'canon-sx70', disabled: true }],
    });

    expect(result.entries[0]).toMatchObject({ shortName: 'Old short name', sameSkuGroupId: 'old-group' });
    expect(result.entries[0].classificationSource).toBeUndefined();
    expect(result.risks).toEqual([{ type: 'disabled_override', message: 'Disabled entry override ignored: 701', internalProductId: '701' }]);
  });

  it('classifies matching short names without changing unmatched entries', () => {
    const result = applyLinkRegistryOverrides(entries, {
      version: 1,
      shortNameRules: [{ shortName: 'Canon SX70', categoryId: 'camera', categoryName: '相机', productType: 'canon-sx', aliases: ['SX70 HS'], sameSkuGroupId: 'canon-sx70' }],
    });

    expect(result.entries[1]).toMatchObject({ categoryId: 'camera', productType: 'canon-sx', sameSkuGroupId: 'canon-sx70', classificationSource: 'short_name_rule' });
    expect(result.entries[1]?.aliases).toEqual(expect.arrayContaining(['SX70 HS']));
    expect(result.entries[2]).toBe(entries[2]);
  });

  it('applies same sku group alias rules to every matching entry', () => {
    const result = applyLinkRegistryOverrides(entries, {
      version: 1,
      entries: [{ internalProductId: '701', sameSkuGroupId: 'ace-pro-2' }],
      sameSkuGroupAliasRules: [{ sameSkuGroupId: 'ace-pro-2', aliases: ['Ace pro 2', 'AcePro2'] }],
    });

    expect(result.entries[0]?.aliases).toEqual(expect.arrayContaining(['Ace pro 2', 'AcePro2']));
    expect(result.entries[0]?.source).toContain('same_sku_group_alias_rule');
  });

  it('fails fast for duplicate manual overrides', () => {
    expect(() => applyLinkRegistryOverrides(entries, {
      version: 1,
      entries: [
        { internalProductId: '701', categoryId: 'camera' },
        { internalProductId: '701', categoryId: 'camera2' },
      ],
    })).toThrow('Duplicate manual override');
  });

  it('parses and rejects malformed override contracts', () => {
    expect(parseLinkRegistryOverrides({ version: 1, entries: [{ internalProductId: '701', sameSkuGroupId: 'canon-sx70' }], sameSkuGroupAliasRules: [{ sameSkuGroupId: 'canon-sx70', aliases: ['SX70'] }] })).toEqual({ version: 1, entries: [{ internalProductId: '701', sameSkuGroupId: 'canon-sx70' }], shortNameRules: undefined, sameSkuGroupAliasRules: [{ sameSkuGroupId: 'canon-sx70', aliases: ['SX70'] }] });
    expect(() => parseLinkRegistryOverrides({ version: 1, entries: [{ internalProductId: 'bad', sameSkuGroupId: 'Canon SX70' }] })).toThrow('Invalid entry override internalProductId');
    expect(() => parseLinkRegistryOverrides({ version: 2 })).toThrow('version must be 1');
  });

  it('records unknown manual override targets without polluting entries', () => {
    const result = applyLinkRegistryOverrides(entries, { version: 1, entries: [{ internalProductId: '999', categoryId: 'camera' }] });

    expect(result.entries).toEqual(entries);
    expect(result.risks).toEqual([{ type: 'unknown_internal_product_id', message: 'Override target not found: 999', internalProductId: '999' }]);
  });
});
