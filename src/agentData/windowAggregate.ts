import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface WindowAggregateInput {
  outputDir: string;
  endDate: string;
  windowDays: number;
}

export interface WindowProductAggregate {
  internalProductId: string;
  platformProductId?: string;
  productName: string;
  daysCovered: number;
  missingDates: string[];
  exposure: number;
  publicVisits: number;
  dashboardVisits: number;
  createdOrders: number;
  shippedOrders: number;
  amount: number;
}

interface DailyMetricRecord {
  exposure: number;
  publicVisits: number;
  dashboardVisits: number;
  createdOrders: number;
  shippedOrders: number;
  amount: number;
}

interface DailyRowRecord {
  productName: string;
  platformProductId?: string;
  displayProductId: string;
  periods: {
    '1d'?: DailyMetricRecord;
  };
}

interface DailyReportRecord {
  rows: DailyRowRecord[];
}

interface MutableWindowProductAggregate extends WindowProductAggregate {
  coveredDates: Set<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNumber(record: Record<string, unknown>, key: keyof DailyMetricRecord): number {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readMetric(value: unknown): DailyMetricRecord | null {
  if (!isRecord(value)) return null;
  return {
    exposure: readNumber(value, 'exposure'),
    publicVisits: readNumber(value, 'publicVisits'),
    dashboardVisits: readNumber(value, 'dashboardVisits'),
    createdOrders: readNumber(value, 'createdOrders'),
    shippedOrders: readNumber(value, 'shippedOrders'),
    amount: readNumber(value, 'amount'),
  };
}

function readDailyReport(value: unknown): DailyReportRecord {
  if (!isRecord(value) || !Array.isArray(value.rows)) return { rows: [] };
  const rows = value.rows.flatMap((row): DailyRowRecord[] => {
    if (!isRecord(row) || !isRecord(row.periods)) return [];
    const productName = typeof row.productName === 'string' ? row.productName : '';
    const displayProductId = typeof row.displayProductId === 'string' ? row.displayProductId : '';
    if (!displayProductId) return [];
    const metric = readMetric(row.periods['1d']);
    if (!metric) return [];
    const platformProductId = typeof row.platformProductId === 'string' ? row.platformProductId : undefined;
    return [{ productName, displayProductId, periods: { '1d': metric }, ...(platformProductId ? { platformProductId } : {}) }];
  });
  return { rows };
}

function extractInternalProductId(displayProductId: string): string {
  return /^端内\s*id\s*(\d+)$/iu.exec(displayProductId.trim())?.[1] ?? displayProductId.trim();
}

function parseDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) throw new Error('endDate must be YYYY-MM-DD');
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function windowDates(endDate: string, windowDays: number): string[] {
  if (!Number.isInteger(windowDays) || windowDays < 1) throw new Error('windowDays must be a positive integer');
  const end = parseDate(endDate);
  return Array.from({ length: windowDays }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - (windowDays - 1 - index));
    return formatDate(date);
  });
}

async function readDay(outputDir: string, date: string): Promise<DailyReportRecord | null> {
  const path = join(outputDir, date, `公域数据上下文_${date}.json`);
  try {
    return readDailyReport(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function createAggregate(row: DailyRowRecord): MutableWindowProductAggregate {
  const internalProductId = extractInternalProductId(row.displayProductId);
  return {
    internalProductId,
    ...(row.platformProductId ? { platformProductId: row.platformProductId } : {}),
    productName: row.productName,
    daysCovered: 0,
    missingDates: [],
    exposure: 0,
    publicVisits: 0,
    dashboardVisits: 0,
    createdOrders: 0,
    shippedOrders: 0,
    amount: 0,
    coveredDates: new Set<string>(),
  };
}

function addMetric(target: MutableWindowProductAggregate, date: string, metric: DailyMetricRecord): void {
  target.daysCovered += 1;
  target.coveredDates.add(date);
  target.exposure += metric.exposure;
  target.publicVisits += metric.publicVisits;
  target.dashboardVisits += metric.dashboardVisits;
  target.createdOrders += metric.createdOrders;
  target.shippedOrders += metric.shippedOrders;
  target.amount += metric.amount;
}

export async function aggregateWindowProducts(input: WindowAggregateInput): Promise<WindowProductAggregate[]> {
  const dates = windowDates(input.endDate, input.windowDays);
  const products = new Map<string, MutableWindowProductAggregate>();

  for (const date of dates) {
    const report = await readDay(input.outputDir, date);
    if (!report) continue;
    for (const row of report.rows) {
      const metric = row.periods['1d'];
      if (!metric) continue;
      const internalProductId = extractInternalProductId(row.displayProductId);
      const current = products.get(internalProductId) ?? createAggregate(row);
      products.set(internalProductId, current);
      addMetric(current, date, metric);
    }
  }

  return Array.from(products.values())
    .map((product) => {
      const { coveredDates, ...aggregate } = product;
      return {
        ...aggregate,
        missingDates: dates.filter((date) => !coveredDates.has(date)),
      };
    })
    .sort((left, right) => Number(left.internalProductId) - Number(right.internalProductId) || left.internalProductId.localeCompare(right.internalProductId));
}
