import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonAtomic } from './persistence.js';

export interface RefreshSuppressionState {
  version: 1;
  referenceDate: string;
  suppressDelistAttribution: boolean;
}

export function resolveRefreshSuppressionStatePath(outputDir: string): string {
  return join(outputDir, 'state', 'link-registry-refresh-suppression.json');
}

function isRefreshSuppressionState(value: unknown): value is RefreshSuppressionState {
  return Boolean(value)
    && typeof value === 'object'
    && (value as Record<string, unknown>).version === 1
    && typeof (value as Record<string, unknown>).referenceDate === 'string'
    && typeof (value as Record<string, unknown>).suppressDelistAttribution === 'boolean';
}

export async function loadRefreshSuppressionState(outputDir: string): Promise<RefreshSuppressionState | null> {
  try {
    const value = JSON.parse(await readFile(resolveRefreshSuppressionStatePath(outputDir), 'utf8')) as unknown;
    return isRefreshSuppressionState(value) ? value : null;
  } catch {
    return null;
  }
}

export async function writeRefreshSuppressionState(outputDir: string, state: RefreshSuppressionState): Promise<void> {
  await writeJsonAtomic(resolveRefreshSuppressionStatePath(outputDir), state);
}

export function shouldSuppressDelistAttribution(state: RefreshSuppressionState | null, referenceDate: string): boolean {
  return state?.suppressDelistAttribution === true && state.referenceDate === referenceDate;
}