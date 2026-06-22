export type LinkRegistryStatus = 'active' | 'removed' | 'unknown';

export type LinkRegistrySource = 'product_id_mapping' | 'product_name_map' | 'goods_first_seen' | 'goods_link_lifecycle' | 'link_registry_override' | 'short_name_rule';

export type LinkRegistryClassificationSource = 'manual_override' | 'short_name_rule' | 'existing_field' | 'unknown';

export interface LinkRegistryEntry {
  internalProductId: string;
  platformProductId?: string;
  categoryId?: string;
  categoryName?: string;
  productType?: string;
  shortName?: string;
  sameSkuGroupId?: string;
  status: LinkRegistryStatus;
  currentPrice?: number;
  firstSeenDate?: string;
  lastSeenDate?: string;
  classificationSource?: LinkRegistryClassificationSource;
  source: LinkRegistrySource[];
}
