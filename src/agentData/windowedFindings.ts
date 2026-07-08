import { readdir } from 'node:fs/promises';
import { findReportContextByDate } from '../feishuBot/reportStore.js';

export type WindowedPredicate = 'exposure_without_orders';

export interface WindowedFindingsArgs {
  lookbackDays: number;
  predicate: WindowedPredicate;
  endDate?: string;
}

export interface WindowedFindingItem {
  productId: string;
  platformProductId: string;
  productName: string;
  daysMatched: number;
  exposure: number;
  amount: number;
  dates: string[];
}

export interface WindowedFindingsResult {
  predicate: WindowedPredicate;
  startDate: string;
  endDate: string;
  items: WindowedFindingItem[];
}

function shiftDate(date: string, deltaDays: number): string {
  const current = new Date(`${date}T00:00:00.000Z`);
  current.setUTCDate(current.getUTCDate() + deltaDays);
  return current.toISOString().slice(0, 10);
}

async function latestDate(outputDir: string): Promise<string> {
  const entries = await readdir(outputDir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse()[0] ?? new Date().toISOString().slice(0, 10);
}

function internalProductId(displayProductId: string): string {
  return /^端内id\s*(\d+)$/i.exec(displayProductId.trim())?.[1] ?? displayProductId;
}

export async function findWindowedProducts(outputDir: string, args: WindowedFindingsArgs): Promise<WindowedFindingsResult> {
  const endDate = args.endDate ?? await latestDate(outputDir);
  const lookbackDays = Math.max(1, Math.min(args.lookbackDays, 30));
  const startDate = shiftDate(endDate, -(lookbackDays - 1));
  const items = new Map<string, WindowedFindingItem>();

  for (let offset = 0; offset < lookbackDays; offset += 1) {
    const date = shiftDate(endDate, -offset);
    const found = await findReportContextByDate(outputDir, date).catch(() => null);
    if (!found) continue;
    for (const row of found.context.rows) {
      const one = row.periods['1d'];
      if (args.predicate !== 'exposure_without_orders' || !one || one.exposure <= 0 || one.amount !== 0) continue;
      const productId = internalProductId(row.displayProductId);
      const current = items.get(productId) ?? { productId, platformProductId: row.platformProductId, productName: row.productName, daysMatched: 0, exposure: 0, amount: 0, dates: [] };
      current.daysMatched += 1;
      current.exposure += one.exposure;
      current.amount += one.amount;
      current.dates.push(date);
      items.set(productId, current);
    }
  }

  return {
    predicate: args.predicate,
    startDate,
    endDate,
    items: [...items.values()].sort((left, right) => right.daysMatched - left.daysMatched || right.exposure - left.exposure || left.productId.localeCompare(right.productId)),
  };
}
