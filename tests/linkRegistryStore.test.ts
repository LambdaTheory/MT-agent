import { describe, expect, it } from 'vitest';
import { createLinkRegistry } from '../src/linkRegistry/store.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';

const entries: LinkRegistryEntry[] = [
  {
    internalProductId: '701',
    platformProductId: 'platform-701',
    productName: 'Insta360 Ace Pro 2 Full Kit',
    shortName: 'Insta360 Ace Pro 2',
    aliases: ['Ace pro 2', 'AcePro2', 'ace pro'],
    sameSkuGroupId: 'insta360-ace-pro-2',
    categoryName: '运动相机',
    productType: 'insta360-ace-pro',
    status: 'active',
    source: ['product_name_map', 'link_registry_override'],
  },
  {
    internalProductId: '702',
    platformProductId: 'platform-702',
    productName: 'Insta360 Ace Pro 2 Body',
    shortName: 'Insta360 Ace Pro 2',
    aliases: ['Ace pro 2'],
    sameSkuGroupId: 'insta360-ace-pro-2',
    categoryName: '运动相机',
    productType: 'insta360-ace-pro',
    status: 'removed',
    source: ['product_name_map'],
  },
  {
    internalProductId: '703',
    platformProductId: 'platform-703',
    productName: 'Insta360 Ace Pro',
    shortName: 'Insta360 Ace Pro',
    aliases: ['Ace pro'],
    sameSkuGroupId: 'insta360-ace-pro',
    categoryName: '运动相机',
    productType: 'insta360-ace-pro',
    status: 'active',
    source: ['product_name_map'],
  },
];

describe('link registry store', () => {
  it('resolves a unique alias to one same sku group and returns active candidates', () => {
    const store = createLinkRegistry(entries);
    const result = store.resolveAlias('AcePro2');

    expect(result).toMatchObject({
      status: 'unique',
      sameSkuGroupId: 'insta360-ace-pro-2',
      candidateInternalProductIds: ['701'],
    });
  });

  it('returns multiple candidates when aliases are ambiguous across groups', () => {
    const store = createLinkRegistry(entries);
    const result = store.resolveAlias('ace pro');

    expect(result.status).toBe('multiple');
    if (result.status !== 'multiple') throw new Error('expected multiple result');
    expect(result.candidates.map((item) => item.sameSkuGroupId)).toEqual(['insta360-ace-pro', 'insta360-ace-pro-2']);
  });

  it('returns not_found instead of guessing', () => {
    const store = createLinkRegistry(entries);

    expect(store.resolveAlias('totally unknown')).toMatchObject({ status: 'not_found' });
  });

  it('lists same sku group entries as active-only by default', () => {
    const store = createLinkRegistry(entries);

    expect(store.listBySameSkuGroup('insta360-ace-pro-2').map((entry) => entry.internalProductId)).toEqual(['701']);
    expect(store.listBySameSkuGroup('insta360-ace-pro-2', { includeRemoved: true }).map((entry) => entry.internalProductId)).toEqual(['701', '702']);
  });

  it('exposes an audit view through the store', () => {
    const store = createLinkRegistry(entries);
    const audit = store.audit();

    expect(audit.total).toBe(3);
    expect(audit.sameSkuGroups.find((group) => group.sameSkuGroupId === 'insta360-ace-pro-2')).toBeDefined();
  });
});
