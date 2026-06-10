import type { ProductIdMapping } from '../mapping/productIdMapping.js';

export function buildDisplayProductId(platformProductId: string, mapping: ProductIdMapping): string {
  const internalProductId = mapping[platformProductId]?.trim();
  return internalProductId ? `端内ID ${internalProductId}` : `平台商品ID ${platformProductId}`;
}
