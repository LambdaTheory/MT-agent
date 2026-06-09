import type { PeriodCollectionStats } from '../domain/types.js';

export interface RunLog {
  addEvent(message: string): void;
  addPeriodStats(stats: PeriodCollectionStats): void;
  toText(endTime?: string): string;
}

export function createRunLog(startTime: string, targetUrl: string): RunLog {
  const events: string[] = [];
  const periodStats: PeriodCollectionStats[] = [];

  return {
    addEvent(message: string): void {
      events.push(message);
    },
    addPeriodStats(stats: PeriodCollectionStats): void {
      periodStats.push(stats);
    },
    toText(endTime = new Date().toISOString()): string {
      return [
        `start=${startTime}`,
        `end=${endTime}`,
        `targetUrl=${targetUrl}`,
        '',
        'Events:',
        ...events.map((event) => `- ${event}`),
        '',
        'Period Stats:',
        ...periodStats.map(
          (stats) =>
            `[${stats.period}] pages=${stats.pageCount} rows=${stats.rowCount} deduped=${stats.dedupedRowCount} total=${stats.displayedTotalCount ?? 'unknown'} fallback=${stats.pageSizeFallback} complete=${stats.complete}`,
        ),
      ].join('\n');
    },
  };
}
