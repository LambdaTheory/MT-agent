import { describe, expect, it } from 'vitest';
import { buildLinkRegistryAudit } from '../src/linkRegistry/audit.js';
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
});
