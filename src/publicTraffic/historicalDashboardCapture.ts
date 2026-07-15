import { mkdir, writeFile } from 'node:fs/promises';
import type { PeriodKey, RawTableData } from '../domain/types.js';
import type { DashboardQualitySummary } from './dashboardQuality.js';

const PERIODS: PeriodKey[] = ['1d', '7d', '30d'];
const PERIOD_LABELS: Record<PeriodKey, string> = {
  '1d': '1日',
  '7d': '7日',
  '30d': '30日',
};

export interface HistoricalDashboardCaptureManifest {
  dataDate: string;
  actualPageDate: string;
  capturedAt: string;
  reportContextFound: false;
  refreshQuality: DashboardQualitySummary;
  rebuild: 'skipped';
  resend: 'skipped';
  reason: '未找到该业务数据日的既有日报上下文';
}

export async function saveHistoricalDashboardCapture(input: {
  outputDir: string;
  dataDate: string;
  actualPageDate: string;
  rawTables: RawTableData[];
  refreshQuality: DashboardQualitySummary;
  capturedAt: string;
}): Promise<{ dir: string; manifestPath: string }> {
  const tablesByPeriod = new Map(input.rawTables.map((table) => [table.period, table]));
  for (const period of PERIODS) {
    if (!tablesByPeriod.has(period)) throw new Error(`Historical dashboard archive is missing ${period} raw table`);
  }

  const dir = `${input.outputDir}/historical-dashboard-captures/${input.dataDate}`;
  await mkdir(dir, { recursive: true });

  for (const period of PERIODS) {
    const table = tablesByPeriod.get(period)!;
    await writeFile(`${dir}/\u516c\u57df\u8bbf\u95ee\u6570\u636e_${PERIOD_LABELS[period]}.json`, `${JSON.stringify(table, null, 2)}\n`, 'utf8');
  }

  const manifest: HistoricalDashboardCaptureManifest = {
    dataDate: input.dataDate,
    actualPageDate: input.actualPageDate,
    capturedAt: input.capturedAt,
    reportContextFound: false,
    refreshQuality: input.refreshQuality,
    rebuild: 'skipped',
    resend: 'skipped',
    reason: '未找到该业务数据日的既有日报上下文',
  };
  const manifestPath = `${dir}/capture-manifest.json`;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { dir, manifestPath };
}
