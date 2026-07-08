import { describe, expect, it } from 'vitest';
import { buildLinkRegistryAudit } from '../src/linkRegistry/audit.js';
import { parseLinkRegistryOverrides } from '../src/linkRegistry/overrides.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';

const entries: LinkRegistryEntry[] = [
  { internalProductId: '701', platformProductId: 'platform-701', categoryId: 'camera', categoryName: '相机', productType: 'canon-sx', shortName: 'Canon SX70 A', aliases: ['SX70 HS'], sameSkuGroupId: 'canon-sx70', status: 'active', classificationSource: 'manual_override', source: ['product_id_mapping', 'link_registry_override'] },
  { internalProductId: '702', platformProductId: 'platform-702', categoryId: 'camera', categoryName: '相机', productType: 'canon-sx', shortName: 'Canon SX70 B', aliases: ['SX70 HS'], sameSkuGroupId: 'canon-sx70', status: 'removed', source: ['product_id_mapping'] },
  { internalProductId: '703', platformProductId: 'platform-703', categoryId: 'camera', categoryName: '相机', productType: 'canon-sx', shortName: 'Canon SX70 C', sameSkuGroupId: 'canon-sx70', status: 'unknown', source: ['product_id_mapping'] },
  { internalProductId: '704', platformProductId: 'platform-704', categoryId: 'camera', categoryName: '相机', productType: 'sony-zv', shortName: 'Sony ZV-1', aliases: ['Ace pro 2'], sameSkuGroupId: 'sony-zv1', status: 'active', source: ['product_id_mapping'] },
  { internalProductId: '705', shortName: 'Unclassified', aliases: ['Ace pro 2'], status: 'active', source: ['product_id_mapping'] },
];

describe('link registry audit', () => {
  it('summarizes categories, product types, and status counts', () => {
    const audit = buildLinkRegistryAudit(entries);

    expect(audit).toMatchObject({ total: 5, active: 3, removed: 1, unknown: 1 });
    expect(audit.categories.find((category) => category.categoryId === 'camera')).toMatchObject({ categoryName: '相机', active: 2, removed: 1, unknown: 1, total: 4 });
    expect(audit.categories.find((category) => category.categoryId === 'camera')?.productTypes.find((item) => item.productType === 'canon-sx')).toMatchObject({ active: 1, removed: 1, unknown: 1, total: 3 });
  });

  it('exports same sku group confidence and manual markers', () => {
    const audit = buildLinkRegistryAudit(entries);

    expect(audit.sameSkuGroups.find((group) => group.sameSkuGroupId === 'canon-sx70')).toMatchObject({ sampleSize: 3, sampleInsufficient: false, confidence: 'sufficient', manual: true });
    expect(audit.sameSkuGroups.find((group) => group.sameSkuGroupId === 'sony-zv1')).toMatchObject({ sampleSize: 1, sampleInsufficient: true, confidence: 'low', manual: false });
  });

  it('surfaces classification unknown, alias duplicate, mapping-missing, and sample risks', () => {
    const audit = buildLinkRegistryAudit(entries);

    expect(audit.unknownEntries.map((entry) => entry.internalProductId)).toEqual(['705']);
    expect(audit.risks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'classification_unknown', internalProductId: '705' }),
      expect.objectContaining({ type: 'platform_id_mapping_missing', internalProductId: '705' }),
      expect.objectContaining({ type: 'alias_duplicate_hit', shortName: 'Ace pro 2' }),
      expect.objectContaining({ type: 'sample_insufficient', sameSkuGroupId: 'sony-zv1' }),
    ]));
  });

  it('flags sameSkuGroup entries whose productType values differ inside one group', () => {
    const audit = buildLinkRegistryAudit([
      {
        internalProductId: '801',
        platformProductId: 'platform-801',
        categoryId: 'camera',
        categoryName: '相机',
        productType: 'camera',
        shortName: 'Canon R50',
        sameSkuGroupId: 'canon-eos-r50',
        status: 'active',
        source: ['product_id_mapping'],
      },
      {
        internalProductId: '802',
        platformProductId: 'platform-802',
        categoryId: 'accessory',
        categoryName: '配件',
        productType: 'lens-accessory',
        shortName: 'Canon R50 Kit',
        sameSkuGroupId: 'canon-eos-r50',
        status: 'active',
        source: ['product_id_mapping'],
      },
    ]);

    expect(audit.sameSkuGroups.find((group) => group.sameSkuGroupId === 'canon-eos-r50')?.risks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'mixed_product_type', sameSkuGroupId: 'canon-eos-r50' }),
    ]));
    expect(audit.risks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'mixed_product_type', sameSkuGroupId: 'canon-eos-r50' }),
    ]));
  });

  it('flags leaked promo-title style sameSkuGroup ids', () => {
    const leakedGroupId = 'fujifilm-instax-mini90一次成像-婚礼聚会旅游立即出片-相纸可选';
    const audit = buildLinkRegistryAudit([
      {
        internalProductId: '901',
        platformProductId: 'platform-901',
        categoryId: 'camera',
        categoryName: '相机',
        productType: 'instant-camera',
        shortName: 'Mini 90',
        sameSkuGroupId: leakedGroupId,
        status: 'active',
        source: ['goods_first_seen'],
      },
    ]);

    expect(audit.sameSkuGroups.find((group) => group.sameSkuGroupId === leakedGroupId)?.risks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'promo_title_slug_leak', sameSkuGroupId: leakedGroupId }),
    ]));
    expect(audit.risks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'promo_title_slug_leak', sameSkuGroupId: leakedGroupId }),
    ]));
  });

  it('requires a usable categoryId/productType pair before clearing group-level classification risk', () => {
    const sameSkuGroupId = 'split-classification-group';
    const audit = buildLinkRegistryAudit([
      {
        internalProductId: '1001',
        platformProductId: 'platform-1001',
        categoryId: 'camera',
        categoryName: '相机',
        shortName: 'Body only placeholder',
        sameSkuGroupId,
        status: 'active',
        source: ['goods_first_seen'],
      },
      {
        internalProductId: '1002',
        platformProductId: 'platform-1002',
        productType: 'mirrorless-camera',
        shortName: 'Type only placeholder',
        sameSkuGroupId,
        status: 'active',
        source: ['goods_first_seen'],
      },
    ]);

    expect(audit.sameSkuGroups.find((group) => group.sameSkuGroupId === sameSkuGroupId)?.risks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'group_classification_missing', sameSkuGroupId }),
    ]));
    expect(audit.risks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'group_classification_missing', sameSkuGroupId }),
    ]));
  });

  it('surfaces unclassified backlog explicitly as a top-level unclassifiedCount field', () => {
    const audit = buildLinkRegistryAudit(entries);

    // entries fixture has one unclassified entry (705)
    expect(typeof audit.unclassifiedCount).toBe('number');
    expect(audit.unclassifiedCount).toBe(audit.unknownEntries.length);
    expect(audit.unclassifiedCount).toBeGreaterThanOrEqual(1);
  });

  it('rejects an unremappable promo-title slug with Chinese marketing copy as a new sameSkuGroupId in overrides', () => {
    // A novel promo-title slug (not a known remap target) should be rejected, not silently stored
    const unknownPromoSlug = 'sony-zv1-婚礼聚会旅游立即出片-演唱会神器-可租用';
    expect(() => {
      parseLinkRegistryOverrides({
        version: 1,
        entries: [
          {
            internalProductId: '1701',
            sameSkuGroupId: unknownPromoSlug,
          },
        ],
      });
    }).toThrow(/invalid/i);
  });
});
