import { readFile } from 'node:fs/promises';
import type { AgentConfig, PeriodKey } from '../domain/types.js';

const PERIODS = new Set<PeriodKey>(['1d', '7d', '30d']);

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid config field: ${name}`);
  }

  return value;
}

function requirePositiveNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid config field: ${name}`);
  }

  return value;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid config field: ${name}`);
  }

  return value;
}

export function parseAgentConfig(value: unknown): AgentConfig {
  if (!value || typeof value !== 'object') {
    throw new Error('Config must be an object');
  }

  const record = value as Record<string, unknown>;
  const periodsValue = record.periods;

  if (!Array.isArray(periodsValue) || periodsValue.length === 0) {
    throw new Error('Invalid config field: periods');
  }

  const periods = periodsValue.map((period) => {
    if (typeof period !== 'string' || !PERIODS.has(period as PeriodKey)) {
      throw new Error(`Unsupported period: ${String(period)}`);
    }

    return period as PeriodKey;
  });

  return {
    targetUrl: requireString(record.targetUrl, 'targetUrl'),
    periods,
    preferredPageSize: requirePositiveNumber(record.preferredPageSize, 'preferredPageSize'),
    outputDir: requireString(record.outputDir, 'outputDir'),
    browserProfileDir: requireString(record.browserProfileDir, 'browserProfileDir'),
    productIdMappingPath: optionalString(record.productIdMappingPath, 'productIdMappingPath'),
    goodsExportUrl: optionalString(record.goodsExportUrl, 'goodsExportUrl'),
    exposureUrl: optionalString(record.exposureUrl, 'exposureUrl'),
  };
}

export async function loadConfig(path = 'config/agent.config.json'): Promise<AgentConfig> {
  const content = await readFile(path, 'utf8');
  return parseAgentConfig(JSON.parse(content));
}
