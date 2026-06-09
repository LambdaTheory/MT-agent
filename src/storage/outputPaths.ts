import type { PeriodKey } from '../domain/types.js';

export interface OutputPaths {
  dir: string;
  workbook: string;
  markdown: string;
  raw: Record<PeriodKey, string>;
  log: string;
}

export function buildOutputPaths(outputDir: string, date: string): OutputPaths {
  const dir = `${outputDir}/${date}`;

  return {
    dir,
    workbook: `${dir}/MT运营日报_${date}.xlsx`,
    markdown: `${dir}/MT运营日报_${date}.md`,
    raw: {
      '1d': `${dir}/raw-1d.json`,
      '7d': `${dir}/raw-7d.json`,
      '30d': `${dir}/raw-30d.json`,
    },
    log: `${dir}/run.log`,
  };
}
