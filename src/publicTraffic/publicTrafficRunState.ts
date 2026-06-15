import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DashboardQualitySummary } from './dashboardQuality.js';

export interface PublicTrafficRunState {
  date: string;
  firstReportSent: boolean;
  firstReportGeneratedAt: string;
  firstDashboardQuality: DashboardQualitySummary;
  dashboardRefreshResent: boolean;
  dashboardRefreshResentAt?: string;
  dashboardRefreshDecision?: 'saved_raw_only' | 'rebuilt_and_resent' | 'first_report_complete' | 'refresh_still_missing' | 'already_resent';
}

export async function loadPublicTrafficRunState(path: string): Promise<PublicTrafficRunState | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as PublicTrafficRunState;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function savePublicTrafficRunState(path: string, state: PublicTrafficRunState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}
