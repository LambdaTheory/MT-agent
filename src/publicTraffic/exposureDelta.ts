import type { ExposureCumulativeProduct, ExposureDailyDelta } from './types.js';

function byId(rows: ExposureCumulativeProduct[]): Map<string, ExposureCumulativeProduct> {
  return new Map(rows.map((row) => [row.platformProductId, row]));
}

export function computeExposureDailyDelta(date: string, previous: ExposureCumulativeProduct[], current: ExposureCumulativeProduct[]): ExposureDailyDelta[] {
  const previousById = byId(previous);

  return current.map((row) => {
    const old = previousById.get(row.platformProductId);
    if (!old) {
      return { date, productName: row.productName, platformProductId: row.platformProductId, exposure: row.exposure, visits: row.visits, amount: row.amount, custodyDays: row.custodyDays, flags: ['new_product'] };
    }

    const exposure = row.exposure - old.exposure;
    const visits = row.visits - old.visits;
    const amount = row.amount - old.amount;
    if (exposure < 0 || visits < 0 || amount < 0) {
      return { date, productName: row.productName, platformProductId: row.platformProductId, exposure: 0, visits: 0, amount: 0, custodyDays: row.custodyDays, flags: ['counter_reset_or_data_error'] };
    }

    return { date, productName: row.productName, platformProductId: row.platformProductId, exposure, visits, amount, custodyDays: row.custodyDays, flags: [] };
  });
}
