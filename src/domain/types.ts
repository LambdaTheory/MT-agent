export type PeriodKey = '1d' | '7d' | '30d';

export interface AgentConfig {
  targetUrl: string;
  periods: PeriodKey[];
  preferredPageSize: number;
  outputDir: string;
  browserProfileDir: string;
  productIdMappingPath?: string;
  goodsExportUrl?: string;
  exposureUrl?: string;
}

export interface PeriodCollectionStats {
  period: PeriodKey;
  actualPageSizes: number[];
  pageCount: number;
  rowCount: number;
  dedupedRowCount: number;
  displayedTotalCount: number | null;
  pageSizeFallback: boolean;
  complete: boolean;
}

export interface RawTableData {
  period: PeriodKey;
  headers: string[];
  rows: string[][];
  collection: PeriodCollectionStats;
}

export interface ProductMetrics {
  productName: string;
  platformProductId: string;
  spuName?: string;
  spuId?: string;
  visits: number;
  createdOrders: number;
  signedOrders: number;
  reviewedOrders: number;
  shippedOrders: number;
}

export interface PeriodProductMetrics extends ProductMetrics {
  period: PeriodKey;
}

export type RecommendationAction =
  | '疑似失活'
  | '疑似价格问题'
  | '建议补链'
  | '建议加曝光'
  | '高曝光低转化'
  | '稳定优质'
  | '继续观察';

export type Level = '高' | '中' | '低';

export interface ProductAnalysisRow {
  productName: string;
  platformProductId: string;
  internalProductId?: string;
  mappingStatus?: 'mapped' | 'unmapped';
  spuName?: string;
  spuId?: string;
  metrics: Record<PeriodKey, ProductMetrics | null>;
  riskScore: number;
  opportunityScore: number;
  riskLevel: Level;
  opportunityLevel: Level;
  action: RecommendationAction;
  confidence: Level;
  reason: string;
}

export interface DailyReportData {
  date: string;
  rawTables: RawTableData[];
  analysisRows: ProductAnalysisRow[];
  incomplete: boolean;
}
