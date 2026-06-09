export interface PublicTrafficPaths {
  dir: string;
  exposureOverview: string;
  exposureCumulativeProducts: string;
  exposureDailyDelta: string;
  exposure7dSummary: string;
  exposure30dSummary: string;
  goodsListSnapshot: string;
  newProductObservation: string;
  observationState: string;
  markdown: string;
  workbook: string;
  reportContext: string;
  log: string;
}

export function buildPublicTrafficPaths(outputDir: string, date: string): PublicTrafficPaths {
  const dir = `${outputDir}/public-traffic/${date}`;
  return {
    dir,
    exposureOverview: `${dir}/exposure-overview.json`,
    exposureCumulativeProducts: `${dir}/exposure-cumulative-products.json`,
    exposureDailyDelta: `${dir}/exposure-daily-delta.json`,
    exposure7dSummary: `${dir}/exposure-7d-summary.json`,
    exposure30dSummary: `${dir}/exposure-30d-summary.json`,
    goodsListSnapshot: `${dir}/goods-list-snapshot.json`,
    newProductObservation: `${dir}/new-product-observation.json`,
    observationState: `${dir}/observation-state.json`,
    markdown: `${dir}/public-traffic-report.md`,
    workbook: `${dir}/public-traffic-report.xlsx`,
    reportContext: `${dir}/report-context.json`,
    log: `${dir}/run.log`,
  };
}
