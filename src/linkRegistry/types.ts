export type LinkRegistryStatus = 'active' | 'removed' | 'unknown';

export type LinkRegistrySource = 'product_id_mapping' | 'product_name_map' | 'goods_snapshot' | 'goods_first_seen' | 'goods_link_lifecycle' | 'daemon_catalog' | 'link_registry_override' | 'short_name_rule' | 'same_sku_group_rule' | 'same_sku_group_alias_rule';

export type LinkRegistryClassificationSource = 'manual_override' | 'short_name_rule' | 'existing_field' | 'unknown';

export interface LinkRegistryEntry {
  internalProductId: string;
  platformProductId?: string;
  productName?: string;
  categoryId?: string;
  categoryName?: string;
  productType?: string;
  shortName?: string;
  aliases?: string[];
  sameSkuGroupId?: string;
  status: LinkRegistryStatus;
  currentPrice?: number;
  firstSeenDate?: string;
  lastSeenDate?: string;
  daemonStatusText?: string;
  daemonSyncStatus?: string;
  daemonChannels?: string[];
  daemonTags?: string[];
  daemonStockText?: string;
  daemonRowText?: string;
  daemonSnapshotAt?: string;
  confidence?: number;
  updatedAt?: string;
  classificationSource?: LinkRegistryClassificationSource;
  source: LinkRegistrySource[];
}
