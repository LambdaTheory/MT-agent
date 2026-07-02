import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ContextCollector } from './dailyMissionContext.js';

export function createMarketPriceCollector(outputDir: string): ContextCollector {
  return {
    name: 'marketPrice',
    collect: async ({ date }) => {
      const datedPath = join(outputDir, 'daily-mission', date, 'market-price.json');
      const fallbackPath = join(outputDir, 'config', 'market-price.json');
      try {
        return { marketPrice: JSON.parse(await readFile(datedPath, 'utf8')) as unknown };
      } catch (datedError) {
        try {
          return { marketPrice: JSON.parse(await readFile(fallbackPath, 'utf8')) as unknown };
        } catch {
          throw datedError;
        }
      }
    },
  };
}
