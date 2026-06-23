import type { ProductIdMapping } from '../mapping/productIdMapping.js';
import { internalIdFromMerchantCode } from '../mapping/goodsExportMapping.js';
import type { PublicTrafficDataReportContext } from '../publicTraffic/types.js';

const INTERNAL_PRODUCT_ID_PATTERN = /^\u7aef\u5185ID\s*(\d+)$/u;

export interface PickedProduct {
  platformProductId: string;
  merchantProductId: string;
  productName: string;
  pickedOnPage: number;
}

export type PickedProductMappingSource = 'latest_report_context' | 'merchant_product_id' | 'product_id_map' | 'unmapped';

export interface ResolvedPickedProduct extends PickedProduct {
  internalProductId?: string;
  mappingSource: PickedProductMappingSource;
}

export interface ResolvedPickedProductSummary {
  products: ResolvedPickedProduct[];
  mappedCount: number;
  unmappedCount: number;
}

function extractInternalProductId(displayProductId: string): string | undefined {
  return INTERNAL_PRODUCT_ID_PATTERN.exec(displayProductId.trim())?.[1];
}

export function mergePickedProducts(existing: PickedProduct[], additions: PickedProduct[]): PickedProduct[] {
  const merged = [...existing];
  const seen = new Set(existing.map((item) => item.platformProductId));

  for (const item of additions) {
    if (!item.platformProductId || seen.has(item.platformProductId)) continue;
    merged.push(item);
    seen.add(item.platformProductId);
  }

  return merged;
}

export function mapPickedProductsToInternalIds(
  products: PickedProduct[],
  latestReportContext?: PublicTrafficDataReportContext,
  productIdMapping: ProductIdMapping = {},
): ResolvedPickedProductSummary {
  const contextIndex = new Map(
    (latestReportContext?.rows ?? [])
      .map((row) => [row.platformProductId, extractInternalProductId(row.displayProductId)])
      .filter((entry): entry is [string, string] => Boolean(entry[0] && entry[1])),
  );

  const resolvedProducts = products.map<ResolvedPickedProduct>((product) => {
    const fromContext = contextIndex.get(product.platformProductId);
    if (fromContext) return { ...product, internalProductId: fromContext, mappingSource: 'latest_report_context' };

    const fromMerchantProductId = internalIdFromMerchantCode(product.merchantProductId)?.trim();
    if (fromMerchantProductId) {
      return { ...product, internalProductId: fromMerchantProductId, mappingSource: 'merchant_product_id' };
    }

    const fromMapping = productIdMapping[product.platformProductId]?.trim();
    if (fromMapping) return { ...product, internalProductId: fromMapping, mappingSource: 'product_id_map' };

    return { ...product, internalProductId: undefined, mappingSource: 'unmapped' };
  });

  const mappedCount = resolvedProducts.filter((product) => Boolean(product.internalProductId)).length;
  return {
    products: resolvedProducts,
    mappedCount,
    unmappedCount: resolvedProducts.length - mappedCount,
  };
}
