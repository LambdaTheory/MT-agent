import type { CollectedContext } from './dailyMissionContext.js';

export interface FreshnessOptions {
  minExposureRows?: number;
  requireSales?: boolean;
}

export interface FreshnessVerdict {
  fresh: boolean;
  reasons: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readExposure(exposure: unknown): { date: string; rows: number } | null {
  if (!isRecord(exposure)) return null;
  const inner = exposure.context;
  if (!isRecord(inner)) return null;
  if (typeof inner.date !== 'string') return null;
  const rows = Array.isArray(inner.rows) ? inner.rows.length : 0;
  return { date: inner.date, rows };
}

export function assessDataFreshness(context: CollectedContext, options: FreshnessOptions = {}): FreshnessVerdict {
  const minExposureRows = options.minExposureRows ?? 1;
  const requireSales = options.requireSales !== false;
  const reasons: string[] = [];

  if (context.missingSources.includes('exposure')) {
    reasons.push('exposure_missing');
  } else {
    const exposure = readExposure(context.exposure);
    if (!exposure) {
      reasons.push('exposure_unreadable');
    } else {
      if (exposure.date !== context.date) reasons.push('exposure_date_mismatch');
      if (exposure.rows < minExposureRows) reasons.push('exposure_rows_below_min');
    }
  }

  if (requireSales && context.missingSources.includes('sales')) {
    reasons.push('sales_missing');
  }

  return { fresh: reasons.length === 0, reasons };
}
