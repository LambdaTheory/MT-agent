import type { PeriodKey, RawTableData } from '../domain/types.js';

const PERIODS: PeriodKey[] = ['1d', '7d', '30d'];

export interface DashboardPeriodQuality {
  complete: boolean;
  rowCount: number;
  reason?: string;
}

export interface DashboardQualitySummary {
  hasMissing: boolean;
  periods: Record<PeriodKey, DashboardPeriodQuality>;
  notes: string[];
}

export function hasDashboardMissingNote(notes: string[] | undefined): boolean {
  return (notes ?? []).some((note) => /访问数据|访问页|后链路|访问量板块/.test(note) && /缺失|未更新|失败|跳过/.test(note));
}

function assessPeriod(table: RawTableData | undefined): DashboardPeriodQuality {
  if (!table) return { complete: false, rowCount: 0, reason: 'raw 文件缺失' };
  if (table.collection.complete === false) return { complete: false, rowCount: table.collection.rowCount, reason: 'collection.complete=false' };
  if (table.collection.rowCount === 0) return { complete: false, rowCount: 0, reason: 'rowCount=0' };
  if (table.headers.length === 0) return { complete: false, rowCount: table.collection.rowCount, reason: 'headers 为空' };
  if (table.rows.length === 0) return { complete: false, rowCount: table.collection.rowCount, reason: 'rows 为空' };
  return { complete: true, rowCount: table.collection.rowCount };
}

export function assessDashboardQuality(rawTables: RawTableData[], notes: string[] | undefined): DashboardQualitySummary {
  const byPeriod = new Map(rawTables.map((table) => [table.period, table]));
  const periods = Object.fromEntries(PERIODS.map((period) => [period, assessPeriod(byPeriod.get(period))])) as Record<PeriodKey, DashboardPeriodQuality>;
  return {
    hasMissing: hasDashboardMissingNote(notes) || Object.values(periods).some((period) => !period.complete),
    periods,
    notes: notes ?? [],
  };
}

export function formatDashboardQuality(quality: DashboardQualitySummary): string {
  return PERIODS.map((period) => `${period}=${quality.periods[period].complete ? 'complete' : `missing(${quality.periods[period].reason ?? 'unknown'})`}`).join(', ');
}
