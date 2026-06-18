import { describe, expect, it } from 'vitest';
import { createLinkRegistryQuery } from '../src/linkRegistry/queryRegistry.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';

const entries: LinkRegistryEntry[] = [
  { internalProductId: '701', platformProductId: 'platform-701', shortName: '佳能 SX70 A', sameSkuGroupId: 'canon-sx70', status: 'active', source: ['product_id_mapping'] },
  { internalProductId: '702', platformProductId: 'platform-702', shortName: '佳能 SX70 B', sameSkuGroupId: 'canon-sx70', status: 'removed', source: ['goods_link_lifecycle'] },
  { internalProductId: '703', platformProductId: 'platform-703', shortName: '大疆 Pocket3', status: 'unknown', source: ['product_name_map'] },
];

describe('link registry query', () => {
  it('looks up entries by internal product id', () => {
    const query = createLinkRegistryQuery(entries);

    expect(query.byInternalId(' 701 ')).toBe(entries[0]);
    expect(query.byInternalId('999')).toBeNull();
  });

  it('returns all entries in the same sku group', () => {
    const query = createLinkRegistryQuery(entries);

    expect(query.bySameSkuGroup(' canon-sx70 ').map((entry) => entry.internalProductId)).toEqual(['701', '702']);
    expect(query.bySameSkuGroup('missing')).toEqual([]);
  });

  it('does not expose the cached same sku group array for mutation', () => {
    const query = createLinkRegistryQuery(entries);
    const group = query.bySameSkuGroup('canon-sx70');
    group.pop();

    expect(query.bySameSkuGroup('canon-sx70').map((entry) => entry.internalProductId)).toEqual(['701', '702']);
  });
});
