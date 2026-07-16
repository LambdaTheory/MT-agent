export type LinkRegistryStatus = 'active' | 'removed' | 'unknown';

export type LinkListingState = 'on_sale' | 'delisted' | 'gone' | 'unknown';

export type LinkDelistCause =
  | 'platform_review_rejected'
  | 'platform_frozen'
  | 'platform_restricted'
  | 'agent_confirmed_manual_off_shelf'
  | 'external_manual_off_shelf_pending_confirmation';

export type LinkDelistCauseConfidence = 'confirmed' | 'suspected';

export interface LinkDelistCauseEvidence {
  source: 'goods_snapshot' | 'operation_ledger';
  kind: 'platform_restriction' | 'agent_delist_execution';
  observedAt?: string;
  reasonText?: string;
  listingStatusText?: string;
  toolName?: string;
  operationEventAt?: string;
  runId?: string;
  decisionId?: string;
}

export type LinkRegistrySource = 'product_id_mapping' | 'product_name_map' | 'goods_snapshot' | 'goods_first_seen' | 'goods_link_lifecycle' | 'daemon_catalog' | 'exposure' | 'link_registry_override' | 'short_name_rule' | 'same_sku_group_rule' | 'same_sku_group_alias_rule';

export type LinkRegistryClassificationSource = 'manual_override' | 'short_name_rule' | 'existing_field' | 'unknown';

export interface PlatformProductIdConflict {
  platformProductIds: string[];
  internalProductIds: string[];
}

export interface LinkRegistryEntry {
  internalProductId: string;
  platformProductId?: string;
  platformProductIdConflict?: PlatformProductIdConflict;
  productName?: string;
  categoryId?: string;
  categoryName?: string;
  productType?: string;
  shortName?: string;
  aliases?: string[];
  sameSkuGroupId?: string;
  status: LinkRegistryStatus;
  listingState?: LinkListingState;
  statusSource?: string;
  statusObservedAt?: string;
  delistCause?: LinkDelistCause;
  delistCauseConfidence?: LinkDelistCauseConfidence;
  delistCauseEvidence?: LinkDelistCauseEvidence[];
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
