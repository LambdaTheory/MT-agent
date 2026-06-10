import type { ProductIdMapping } from '../mapping/productIdMapping.js';

export function buildDisplayProductId(platformProductId: string, mapping: ProductIdMapping): string {
  const mappedValue = Object.prototype.hasOwnProperty.call(mapping, platformProductId)
    ? mapping[platformProductId]
    : undefined;
  const internalProductId = typeof mappedValue === 'string' ? mappedValue.trim() : '';
  return internalProductId ? `端内ID ${internalProductId}` : `平台商品ID ${platformProductId}`;
}
