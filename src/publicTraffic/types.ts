export interface ExposureOverviewMetric {
  period: '1d' | '7d' | '30d';
  exposure: number;
  visits: number;
  conversionRate: number;
  amount: number;
}

export interface ExposureCumulativeProduct {
  productName: string;
  platformProductId: string;
  exposure: number;
  visits: number;
  amount: number;
  custodyDays: number | null;
  raw: Record<string, string>;
}

export type ExposureDeltaFlag = 'new_product' | 'missing' | 'counter_reset_or_data_error';

export interface ExposureDailyDelta {
  date: string;
  productName: string;
  platformProductId: string;
  exposure: number;
  visits: number;
  amount: number;
  custodyDays: number | null;
  flags: ExposureDeltaFlag[];
}

export interface ExposureProductSummary {
  productName: string;
  platformProductId: string;
  exposure: number;
  visits: number;
  amount: number;
  visitRate: number;
  days: number;
  flags: ExposureDeltaFlag[];
}

export interface GoodsSnapshotItem {
  platformProductId: string;
  internalProductId: string;
  productName: string;
}

export interface NewProductObservationItem extends GoodsSnapshotItem {
  date: string;
  source: 'goods_diff' | 'recent_internal_id';
}
