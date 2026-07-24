import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ContextCollector } from './dailyMissionContext.js';
import { createPriceMonitorApiClient, type PriceMonitorApiClient } from './marketPriceApiClient.js';

export interface MarketPriceCollectorOptions {
  outputDir: string;
  apiClient?: PriceMonitorApiClient;
  apiBaseUrl?: string;
  productFilters?: string[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function splitList(value: string | undefined): string[] {
  return value?.split(/[\s,;]+/).map((item) => item.trim()).filter((item) => item.length > 0) ?? [];
}

function firstValue(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0);
}

function optionsFromEnv(env: NodeJS.ProcessEnv): Pick<MarketPriceCollectorOptions, 'apiBaseUrl' | 'productFilters' | 'timeoutMs'> {
  return {
    apiBaseUrl: firstValue(env.MT_AGENT_PRICE_MONITOR_BASE_URL, env.MARKET_PRICE_API_BASE_URL),
    productFilters: splitList(firstValue(env.MT_AGENT_PRICE_MONITOR_PRODUCTS, env.MARKET_PRICE_PRODUCTS)),
    timeoutMs: parsePositiveInteger(firstValue(env.MT_AGENT_PRICE_MONITOR_TIMEOUT_MS, env.MARKET_PRICE_API_TIMEOUT_MS)),
  };
}

function assertMissionDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid Daily Mission date: ${date}`);
}

async function loadLocalMarketPrice(outputDir: string, date: string): Promise<unknown> {
  assertMissionDate(date);
  const datedPath = join(outputDir, 'daily-mission', date, 'market-price.json');
  const fallbackPath = join(outputDir, 'config', 'market-price.json');
  try {
    return JSON.parse(await readFile(datedPath, 'utf8')) as unknown;
  } catch (datedError) {
    try {
      return JSON.parse(await readFile(fallbackPath, 'utf8')) as unknown;
    } catch {
      throw datedError;
    }
  }
}

async function writeDatedMarketPrice(outputDir: string, date: string, marketPrice: unknown): Promise<void> {
  assertMissionDate(date);
  const missionDir = join(outputDir, 'daily-mission', date);
  await mkdir(missionDir, { recursive: true });
  await writeFile(join(missionDir, 'market-price.json'), `${JSON.stringify(marketPrice, null, 2)}\n`, 'utf8');
}

function resolveOptions(outputDirOrOptions: string | MarketPriceCollectorOptions): Required<Pick<MarketPriceCollectorOptions, 'outputDir' | 'productFilters'>> & Omit<MarketPriceCollectorOptions, 'outputDir' | 'productFilters'> {
  if (typeof outputDirOrOptions !== 'string') {
    const envOptions = optionsFromEnv(outputDirOrOptions.env ?? process.env);
    return {
      ...envOptions,
      ...outputDirOrOptions,
      productFilters: outputDirOrOptions.productFilters ?? envOptions.productFilters ?? [],
    };
  }
  const envOptions = optionsFromEnv(process.env);
  return { outputDir: outputDirOrOptions, productFilters: envOptions.productFilters ?? [], ...envOptions };
}

export function createMarketPriceCollector(outputDirOrOptions: string | MarketPriceCollectorOptions): ContextCollector {
  const options = resolveOptions(outputDirOrOptions);
  return {
    name: 'marketPrice',
    collect: async ({ date }) => {
      const apiClient = options.apiClient ?? (options.apiBaseUrl ? createPriceMonitorApiClient({ baseUrl: options.apiBaseUrl, timeoutMs: options.timeoutMs, fetchImpl: options.fetchImpl }) : undefined);
      if (apiClient) {
        let marketPrice: unknown;
        try {
          marketPrice = await apiClient.latestPricing(options.productFilters);
        } catch {
          return { marketPrice: await loadLocalMarketPrice(options.outputDir, date) };
        }
        await writeDatedMarketPrice(options.outputDir, date, marketPrice);
        return { marketPrice };
      }
      return { marketPrice: await loadLocalMarketPrice(options.outputDir, date) };
    },
  };
}
