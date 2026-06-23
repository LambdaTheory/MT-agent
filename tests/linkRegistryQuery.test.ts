import { describe, expect, it } from 'vitest';
import { createLinkRegistryQuery } from '../src/linkRegistry/queryRegistry.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';

const entries: LinkRegistryEntry[] = [
  { internalProductId: '701', platformProductId: 'platform-701', shortName: 'Canon SX70 A', sameSkuGroupId: 'canon-sx70', status: 'active', source: ['product_id_mapping'] },
  { internalProductId: '702', platformProductId: 'platform-702', shortName: 'Canon SX70 B', sameSkuGroupId: 'canon-sx70', status: 'removed', source: ['goods_link_lifecycle'] },
  { internalProductId: '704', platformProductId: 'platform-704', shortName: 'Canon SX70 C', sameSkuGroupId: 'canon-sx70', status: 'active', source: ['product_id_mapping'] },
  { internalProductId: '703', platformProductId: 'platform-703', shortName: 'DJI Pocket3', status: 'unknown', source: ['product_name_map'] },
  { internalProductId: '705', platformProductId: 'platform-705', shortName: 'Sony ZV-1 A', sameSkuGroupId: 'sony-zv1', status: 'active', source: ['product_id_mapping'] },
  { internalProductId: '706', platformProductId: 'platform-706', shortName: 'Sony ZV-1 B', sameSkuGroupId: 'sony-zv1', status: 'active', source: ['product_id_mapping'] },
];

describe('link registry query', () => {
  it('looks up entries by internal product id', () => {
    const query = createLinkRegistryQuery(entries);

    expect(query.byInternalId(' 701 ')).toBe(entries[0]);
    expect(query.getByInternalId(' 701 ')).toBe(entries[0]);
    expect(query.byInternalId('999')).toBeNull();
  });

  it('returns all entries in the same sku group', () => {
    const query = createLinkRegistryQuery(entries);

    expect(query.bySameSkuGroup(' canon-sx70 ')).toMatchObject({
      sameSkuGroupId: 'canon-sx70',
      sampleSize: 3,
      sampleInsufficient: false,
      confidence: 'sufficient',
    });
    expect(query.bySameSkuGroup('canon-sx70').entries.map((entry) => entry.internalProductId)).toEqual(['701', '702', '704']);
  });

  it('returns a none-confidence result when the same sku group is missing', () => {
    const query = createLinkRegistryQuery(entries);

    expect(query.bySameSkuGroup(' missing ')).toEqual({
      sameSkuGroupId: 'missing',
      entries: [],
      sampleSize: 0,
      sampleInsufficient: true,
      confidence: 'none',
    });
  });

  it('marks 1-2 entry same sku groups as low-confidence sample insufficient results', () => {
    const query = createLinkRegistryQuery(entries);

    expect(query.bySameSkuGroup('sony-zv1')).toMatchObject({
      sameSkuGroupId: 'sony-zv1',
      sampleSize: 2,
      sampleInsufficient: true,
      confidence: 'low',
    });
  });

  it('lists active entries by default and can opt into removed or unknown statuses', () => {
    const query = createLinkRegistryQuery(entries);

    expect(query.listBySameSkuGroup('canon-sx70').map((entry) => entry.internalProductId)).toEqual(['701', '704']);
    expect(query.listBySameSkuGroup('canon-sx70', { includeRemoved: true, includeUnknown: true }).map((entry) => entry.internalProductId)).toEqual(['701', '702', '704']);
  });

  it('does not expose the cached same sku group array for mutation', () => {
    const query = createLinkRegistryQuery(entries);
    const group = query.bySameSkuGroup('canon-sx70').entries;
    group.pop();

    expect(query.bySameSkuGroup('canon-sx70').entries.map((entry) => entry.internalProductId)).toEqual(['701', '702', '704']);
  });
});
