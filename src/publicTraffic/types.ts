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
