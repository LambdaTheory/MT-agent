import type { PeriodKey } from '../domain/types.js';
import type { PublicTrafficDataReportContext, PublicTrafficPeriodMetrics, PublicTrafficProductDataRow } from '../publicTraffic/types.js';

export const PRODUCT_QUERY_PERIODS: PeriodKey[] = ['1d', '7d', '30d'];

export interface ProductQueryPeriodMetric {
  period: PeriodKey;
  exposure: number | null;
  visits: number | null;
  shippedOrders: number | null;
  hasExposureData: boolean;
  hasDashboardData: boolean;
}

export interface ProductQueryMatch {
  input: string;
  row: PublicTrafficProductDataRow;
  internalProductId: string;
  platformProductId: string | null;
  periods: ProductQueryPeriodMetric[];
}

export interface ProductQueryMissing {
  input: string;
}

export interface ProductQueryAmbiguous {
  input: string;
  candidates: ProductQueryMatch[];
}

export interface ProductQueryResult {
  matches: ProductQueryMatch[];
  missing: ProductQueryMissing[];
  ambiguous: ProductQueryAmbiguous[];
}

function normalizeProductIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

export function extractInternalProductId(displayProductId: string): string | null {
  return /^端内id\s*(\d+)$/i.exec(displayProductId.trim())?.[1] ?? null;
}

export function parseNumericProductQueryList(keyword: string): string[] {
  const tokens = keyword
    .trim()
    .replace(/[;；。]+$/g, '')
    .split(/[,，、\s;；]+/)
    .filter(Boolean);
  if (tokens.length < 1 || tokens.some((token) => !/^\d+$/.test(token))) return [];
  return tokens;
}

function readPeriodMetric(row: PublicTrafficProductDataRow, period: PeriodKey): ProductQueryPeriodMetric {
  const metric = row.periods[period] as PublicTrafficPeriodMetrics | undefined;
  return {
    period,
    exposure: metric?.hasExposureData === false ? null : metric?.exposure ?? null,
    visits: metric?.hasDashboardData === false ? null : metric?.publicVisits ?? metric?.dashboardVisits ?? null,
    shippedOrders: metric?.hasDashboardData === false ? null : metric?.shippedOrders ?? null,
    hasExposureData: metric?.hasExposureData === true,
    hasDashboardData: metric?.hasDashboardData === true,
  };
}

export function productQueryMatch(input: string, row: PublicTrafficProductDataRow): ProductQueryMatch {
  return {
    input,
    row,
    internalProductId: extractInternalProductId(row.displayProductId) ?? row.displayProductId.trim(),
    platformProductId: row.platformProductId.trim() || null,
    periods: PRODUCT_QUERY_PERIODS.map((period) => readPeriodMetric(row, period)),
  };
}

function sameRow(left: PublicTrafficProductDataRow, right: PublicTrafficProductDataRow): boolean {
  return left === right
    || (
      left.displayProductId === right.displayProductId
      && left.platformProductId === right.platformProductId
      && left.productName === right.productName
    );
}

function dedupeRows(rows: PublicTrafficProductDataRow[]): PublicTrafficProductDataRow[] {
  const result: PublicTrafficProductDataRow[] = [];
  for (const row of rows) {
    if (!result.some((item) => sameRow(item, row))) result.push(row);
  }
  return result;
}

function rowsMatchingNumericInput(context: PublicTrafficDataReportContext, input: string): PublicTrafficProductDataRow[] {
  const internalMatches = context.rows.filter((row) => extractInternalProductId(row.displayProductId) === input || normalizeProductIdentifier(row.displayProductId) === input);
  const platformMatches = context.rows.filter((row) => normalizeProductIdentifier(row.platformProductId) === input);
  return dedupeRows([...internalMatches, ...platformMatches]);
}

function rowsMatchingKeyword(context: PublicTrafficDataReportContext, keyword: string): PublicTrafficProductDataRow[] {
  const normalized = normalizeProductIdentifier(keyword);
  if (!normalized) return [];
  if (/^\d+$/.test(normalized)) return rowsMatchingNumericInput(context, normalized);

  return context.rows
    .filter((row) => (
      normalizeProductIdentifier(row.displayProductId) === normalized
      || normalizeProductIdentifier(row.platformProductId) === normalized
      || row.productName.toLowerCase().includes(normalized)
    ))
    .slice(0, 5);
}

export function queryProducts(context: PublicTrafficDataReportContext, keyword: string): ProductQueryResult {
  const numericInputs = parseNumericProductQueryList(keyword);
  const inputs = numericInputs.length ? numericInputs : [keyword.trim()].filter(Boolean);
  const matches: ProductQueryMatch[] = [];
  const missing: ProductQueryMissing[] = [];
  const ambiguous: ProductQueryAmbiguous[] = [];

  for (const input of inputs) {
    const rows = numericInputs.length ? rowsMatchingNumericInput(context, input) : rowsMatchingKeyword(context, input);
    if (rows.length === 0) {
      missing.push({ input });
      continue;
    }
    if (/^\d+$/.test(input) && rows.length > 1) {
      ambiguous.push({ input, candidates: rows.map((row) => productQueryMatch(input, row)) });
      continue;
    }
    matches.push(...rows.map((row) => productQueryMatch(input, row)));
  }

  return { matches, missing, ambiguous };
}

export function findProductBySectionIdentifier(context: PublicTrafficDataReportContext, identifier: unknown): ProductQueryMatch | null {
  if (typeof identifier !== 'string') return null;
  const normalizedIdentifier = identifier.trim();
  const internalId = extractInternalProductId(normalizedIdentifier) ?? (/^\d+$/.test(normalizedIdentifier) ? normalizedIdentifier : null);
  if (!internalId) return null;
  const row = rowsMatchingNumericInput(context, internalId)[0];
  return row ? productQueryMatch(internalId, row) : null;
}
