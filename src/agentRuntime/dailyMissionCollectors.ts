import { findReportContextByDate } from '../feishuBot/reportStore.js';
import type { ContextCollector } from './dailyMissionContext.js';

async function loadReportContext(outputDir: string, date: string) {
  const byDate = await findReportContextByDate(outputDir, date);
  if (byDate) return byDate.context;
  throw new Error(`No public traffic report context for ${date}`);
}

export function createExposureCollector(outputDir: string): ContextCollector {
  return {
    name: 'exposure',
    collect: async ({ date }) => {
      const context = await loadReportContext(outputDir, date);
      return { exposure: { date: context.date, source: 'publicTraffic', context } };
    },
  };
}

export function createSalesCollector(outputDir: string): ContextCollector {
  return {
    name: 'sales',
    collect: async ({ date }) => {
      const context = await loadReportContext(outputDir, date);
      return { sales: { date: context.date, source: 'orderAnalysis', context } };
    },
  };
}
