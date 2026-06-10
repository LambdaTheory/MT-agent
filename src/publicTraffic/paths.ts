import type { PeriodKey } from '../domain/types.js';

export interface PublicTrafficPaths {
  dir: string;
  exposureOverview: string;
  exposureCumulativeProducts: string;
  exposureDailyDelta: string;
  exposure7dSummary: string;
  exposure30dSummary: string;
  publicVisitRaw: Record<PeriodKey, string>;
  goodsListSnapshot: string;
  newProductObservation: string;
  observationState: string;
  markdown: string;
  workbook: string;
  reportContext: string;
  log: string;
}

export function buildPublicTrafficPaths(outputDir: string, date: string): PublicTrafficPaths {
  const dir = `${outputDir}/${date}`;
  return {
    dir,
    exposureOverview: `${dir}/公域曝光总览_${date}.json`,
    exposureCumulativeProducts: `${dir}/公域曝光商品快照_${date}.json`,
    exposureDailyDelta: `${dir}/公域曝光日差分_${date}.json`,
    exposure7dSummary: `${dir}/公域曝光7日汇总_${date}.json`,
    exposure30dSummary: `${dir}/公域曝光30日汇总_${date}.json`,
    publicVisitRaw: {
      '1d': `${dir}/公域访问数据_1日.json`,
      '7d': `${dir}/公域访问数据_7日.json`,
      '30d': `${dir}/公域访问数据_30日.json`,
    },
    goodsListSnapshot: `${dir}/goods-list-snapshot.json`,
    newProductObservation: `${dir}/new-product-observation.json`,
    observationState: `${dir}/observation-state.json`,
    markdown: `${dir}/公域数据日报_${date}.md`,
    workbook: `${dir}/公域数据日报_${date}.xlsx`,
    reportContext: `${dir}/公域数据上下文_${date}.json`,
    log: `${dir}/公域数据运行日志_${date}.log`,
  };
}
