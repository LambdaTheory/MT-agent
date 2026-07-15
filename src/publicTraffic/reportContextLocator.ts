import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PublicTrafficDataReportContext } from './types.js';
import { buildPublicTrafficPaths } from './paths.js';

export interface LocatedPublicTrafficReport {
  runDate: string;
  dir: string;
  contextPath: string;
  context: PublicTrafficDataReportContext;
}

const reportDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

export async function findPublicTrafficReportByDataDate(outputDir: string, dataDate: string): Promise<LocatedPublicTrafficReport | null> {
  if (!reportDatePattern.test(dataDate)) throw new Error('dataDate must be YYYY-MM-DD');

  const entries = await readdir(outputDir, { withFileTypes: true }).catch((error: unknown) => {
    if (isEnoent(error)) return [];
    throw error;
  });
  const runDates = entries
    .filter((entry) => entry.isDirectory() && reportDatePattern.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));

  for (const runDate of runDates) {
    const paths = buildPublicTrafficPaths(outputDir, runDate);
    const dir = join(outputDir, runDate);
    const contextPaths = [paths.reportContext, join(dir, 'report-context.json')];

    for (const contextPath of contextPaths) {
      try {
        const context = JSON.parse(await readFile(contextPath, 'utf8')) as PublicTrafficDataReportContext;
        if (context.date === dataDate) return { runDate, dir, contextPath, context };
      } catch (error) {
        if (isEnoent(error)) continue;
        throw error;
      }
    }
  }

  return null;
}
