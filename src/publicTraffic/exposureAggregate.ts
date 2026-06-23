import type { ExposureDailyDelta, ExposureDeltaFlag, ExposureProductSummary } from './types.js';
import { resolveFallbackProductId } from './extractProductIdFromInfo.js';

type ProductIdMappingLike = Record<string, string>;

function canonicalProductId(platformProductId: string, mapping: ProductIdMappingLike): string {
  return resolveFallbackProductId(platformProductId, mapping) ?? platformProductId;
}

export function aggregateExposureDeltas(rows: ExposureDailyDelta[], mapping: ProductIdMappingLike = {}): ExposureProductSummary[] {
  const grouped = new Map<string, ExposureProductSummary & { flagSet: Set<ExposureDeltaFlag> }>();

  for (const row of rows) {
    const platformProductId = canonicalProductId(row.platformProductId, mapping);
    const existing = grouped.get(platformProductId) ?? {
      productName: row.productName,
      platformProductId,
      exposure: 0,
      visits: 0,
      amount: 0,
      visitRate: 0,
      days: 0,
      flags: [],
      flagSet: new Set<ExposureDeltaFlag>(),
    };

    existing.productName = row.productName || existing.productName;
    existing.exposure += row.exposure;
    existing.visits += row.visits;
    existing.amount += row.amount;
    existing.days += 1;
    row.flags.forEach((flag) => existing.flagSet.add(flag));
    grouped.set(platformProductId, existing);
  }

  return Array.from(grouped.values()).map(({ flagSet, ...row }) => ({
    ...row,
    visitRate: row.exposure > 0 ? row.visits / row.exposure : 0,
    flags: Array.from(flagSet),
  }));
}
