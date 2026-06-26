import type { PeriodKey } from '../domain/types.js';
import { buildPublicTrafficArtifactManifestPath, type PublicTrafficArtifactStage } from './artifacts.js';

export interface PublicTrafficPaths {
  dir: string;
  exposureOverview: string;
  exposureCumulativeProducts: string;
  exposureDailyDelta: string;
  exposure7dSummary: string;
  exposure30dSummary: string;
  publicVisitRaw: Record<PeriodKey, string>;
  goodsListSnapshot: string;
  goodsExportWorkbook: string;
  productIdMappingSyncLog: string;
  newProductObservation: string;
  observationState: string;
  goodsFirstSeenState: string;
  goodsLinkLifecycleState: string;
  orderAnalysis: string;
  artifactManifests: Record<PublicTrafficArtifactStage, string>;
  markdown: string;
  workbook: string;
  reportContext: string;
  sameSkuSnapshot: string;
  publicTrafficRunState: string;
  log: string;
  latestLog: string;
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
    goodsExportWorkbook: `${dir}/商品总表_${date}.xlsx`,
    productIdMappingSyncLog: `${dir}/商品ID映射同步日志_${date}.log`,
    newProductObservation: `${dir}/new-product-observation.json`,
    observationState: `${dir}/observation-state.json`,
    goodsFirstSeenState: `${outputDir}/state/goods-first-seen.json`,
    goodsLinkLifecycleState: `${outputDir}/state/goods-link-lifecycle.json`,
    orderAnalysis: `${dir}/订单分析_${date}.json`,
    artifactManifests: {
      'goods-export': buildPublicTrafficArtifactManifestPath(outputDir, date, 'goods-export'),
      exposure: buildPublicTrafficArtifactManifestPath(outputDir, date, 'exposure'),
      dashboard: buildPublicTrafficArtifactManifestPath(outputDir, date, 'dashboard'),
      'order-analysis': buildPublicTrafficArtifactManifestPath(outputDir, date, 'order-analysis'),
    },
    markdown: `${dir}/公域数据日报_${date}.md`,
    workbook: `${dir}/公域数据日报_${date}.xlsx`,
    reportContext: `${dir}/公域数据上下文_${date}.json`,
    sameSkuSnapshot: `${dir}/同款组经营快照_${date}.json`,
    publicTrafficRunState: `${dir}/public-traffic-run-state.json`,
    log: `${dir}/公域数据运行日志_${date}.log`,
    latestLog: `${outputDir}/latest/公域数据运行日志_latest.log`,
  };
}
