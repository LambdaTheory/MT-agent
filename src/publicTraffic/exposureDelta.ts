import type { ExposureCumulativeProduct, ExposureDailyDelta } from './types.js';
import { resolveFallbackProductId } from './extractProductIdFromInfo.js';

type ProductIdMappingLike = Record<string, string>;

function canonicalProductId(platformProductId: string, mapping: ProductIdMappingLike): string {
  return resolveFallbackProductId(platformProductId, mapping) ?? platformProductId;
}

function byId(rows: ExposureCumulativeProduct[], mapping: ProductIdMappingLike): Map<string, ExposureCumulativeProduct> {
  return new Map(rows.map((row) => [canonicalProductId(row.platformProductId, mapping), row]));
}

export function computeExposureDailyDelta(date: string, previous: ExposureCumulativeProduct[], current: ExposureCumulativeProduct[], mapping: ProductIdMappingLike = {}): ExposureDailyDelta[] {
  const previousById = byId(previous, mapping);
  const currentById = byId(current, mapping);

  const deltas: ExposureDailyDelta[] = current.map((row) => {
    const platformProductId = canonicalProductId(row.platformProductId, mapping);
    const old = previousById.get(platformProductId);
    if (!old) {
      return { date, productName: row.productName, platformProductId, exposure: row.exposure, visits: row.visits, amount: row.amount, custodyDays: row.custodyDays, flags: ['new_product'] };
    }

    const exposure = row.exposure - old.exposure;
    const visits = row.visits - old.visits;
    const amount = row.amount - old.amount;
    if (exposure < 0 || visits < 0 || amount < 0) {
      return { date, productName: row.productName, platformProductId, exposure: 0, visits: 0, amount: 0, custodyDays: row.custodyDays, flags: ['counter_reset_or_data_error'] };
    }

    return { date, productName: row.productName, platformProductId, exposure, visits, amount, custodyDays: row.custodyDays, flags: [] };
  });

  for (const row of previous) {
    const platformProductId = canonicalProductId(row.platformProductId, mapping);
    if (!currentById.has(platformProductId)) {
      deltas.push({ date, productName: row.productName, platformProductId, exposure: 0, visits: 0, amount: 0, custodyDays: row.custodyDays, flags: ['missing'] });
    }
  }

  return deltas;
}
