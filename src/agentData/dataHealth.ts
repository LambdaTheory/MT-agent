import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface DataHealthReport {
  date: string;
  hasReportContext: boolean;
  dataQualityNotes: string[];
  missingIdSampleCount: number;
  latestMissingIdSamplePath?: string;
  orderAnalysisDate?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function readJsonIfExists(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function readOrderAnalysisDate(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.pages)) return undefined;
  for (const page of Object.values(value.pages)) {
    if (!isRecord(page)) continue;
    if (typeof page.dataDate === 'string' && page.dataDate.trim()) return page.dataDate.trim();
  }
  return undefined;
}

function countMissingIdSamples(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (!isRecord(value)) return 0;
  if (Array.isArray(value.samples)) return value.samples.length;
  if (Array.isArray(value.rows)) return value.rows.length;
  if (Array.isArray(value.items)) return value.items.length;
  return 0;
}

export async function buildDataHealthReport(outputDir: string, date: string): Promise<DataHealthReport> {
  const dayDir = join(outputDir, date);
  const reportContextPath = join(dayDir, `公域数据上下文_${date}.json`);
  const orderAnalysisPath = join(dayDir, `订单分析_${date}.json`);
  const missingIdSamplePath = join(dayDir, `曝光无ID样本_${date}.json`);

  const [reportContext, orderAnalysis, missingIdSample] = await Promise.all([
    readJsonIfExists(reportContextPath),
    readJsonIfExists(orderAnalysisPath),
    readJsonIfExists(missingIdSamplePath),
  ]);

  const hasReportContext = reportContext !== null;
  const dataQualityNotes = isRecord(reportContext) ? readStringArray(reportContext.dataQualityNotes) : [];
  const missingIdSampleCount = countMissingIdSamples(missingIdSample);
  const orderAnalysisDate = readOrderAnalysisDate(orderAnalysis);

  return {
    date,
    hasReportContext,
    dataQualityNotes,
    missingIdSampleCount,
    ...(missingIdSample !== null ? { latestMissingIdSamplePath: missingIdSamplePath } : {}),
    ...(orderAnalysisDate ? { orderAnalysisDate } : {}),
  };
}
