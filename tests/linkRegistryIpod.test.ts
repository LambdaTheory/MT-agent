import { describe, expect, it } from 'vitest';
import { buildLinkRegistry } from '../src/linkRegistry/buildRegistry.js';
import { canonicalProductShortName } from '../src/publicTraffic/productDisplayName.js';

describe('link registry iPod support', () => {
  it('normalizes iPod touch product names into a stable short name', () => {
    expect(canonicalProductShortName('Ipod touch6 顺丰发货，1天起租')).toBe('iPod touch 6');
  });

  it('infers a clean same sku group and classification for iPod touch entries', () => {
    const registry = buildLinkRegistry({
      lifecycle: {
        active: {
          '653': { platformProductId: '2026042822000820052623', productName: 'Ipod touch6 顺丰发货，1天起租' },
        },
        removedLinks: [],
      },
      productNameMap: {
        '653': 'iPod touch 6',
      },
    });

    expect(registry).toMatchObject([
      {
        internalProductId: '653',
        shortName: 'iPod touch 6',
        sameSkuGroupId: 'ipod-touch-6',
        categoryId: 'media-player',
        categoryName: '播放器',
        productType: 'music-player',
      },
    ]);
  });
});
