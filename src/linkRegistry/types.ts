export type LinkRegistryStatus = 'active' | 'removed' | 'unknown';

export type LinkRegistrySource = 'product_id_mapping' | 'product_name_map' | 'goods_first_seen' | 'goods_link_lifecycle';

export interface LinkRegistryEntry {
  internalProductId: string;
  platformProductId?: string;
  shortName?: string;
  sameSkuGroupId?: string;
  status: LinkRegistryStatus;
  currentPrice?: number;
  firstSeenDate?: string;
  lastSeenDate?: string;
  source: LinkRegistrySource[];
}
