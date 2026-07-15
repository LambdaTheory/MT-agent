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
  const dir = `${input.outputDir}/historical-dashboard-captures/${input.dataDate}`;
  await mkdir(dir, { recursive: true });

  for (const period of PERIODS) {
    const table = input.rawTables.find((item) => item.period === period);
    if (!table) throw new Error(`Historical dashboard archive is missing ${period} raw table`);
    await writeFile(`${dir}/公域访问数据_${PERIOD_LABELS[period]}.json`, `${JSON.stringify(table, null, 2)}\n`, 'utf8');
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
