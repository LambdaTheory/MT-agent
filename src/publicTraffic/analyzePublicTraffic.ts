import type { PublicTrafficRulesConfig } from './rulesConfig.js';
import type { ExposureCumulativeProduct, ExposureDailyDelta, ExposureProductSummary, PublicTrafficReportSectionItem } from './types.js';

export interface AnalyzePublicTrafficInput {
  date: string;
  dailyDelta: ExposureDailyDelta[];
  sevenDaySummary: ExposureProductSummary[];
  thirtyDaySummary: ExposureProductSummary[];
  cumulativeProducts: ExposureCumulativeProduct[];
  config: PublicTrafficRulesConfig;
}

export interface AnalyzePublicTrafficResult {
  exposureOptimization: PublicTrafficReportSectionItem[];
  conversionOptimization: PublicTrafficReportSectionItem[];
  newProductObservation: PublicTrafficReportSectionItem[];
  lifecycleGovernance: PublicTrafficReportSectionItem[];
}

function identifier(platformProductId: string): string {
  return `平台商品ID ${platformProductId}`;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function topN<T>(rows: T[], n: number): T[] {
  return rows.slice(0, n);
}

function exposureOptimization(input: AnalyzePublicTrafficInput): PublicTrafficReportSectionItem[] {
  const rules = input.config.exposureOptimization;
  const candidates = input.sevenDaySummary
    .filter((row) => !row.flags.includes('missing'))
    .flatMap((row) => {
      if (row.exposure >= rules.highExposure && row.visitRate <= rules.lowVisitRate) {
        return [{ row, score: row.exposure * (rules.lowVisitRate - row.visitRate + 0.0001), reason: `7日曝光 ${row.exposure}，访问率 ${percent(row.visitRate)}，低于阈值 ${percent(rules.lowVisitRate)}` }];
      }
      if (row.exposure <= rules.lowExposure && (row.visits >= rules.potentialVisits || row.amount >= rules.potentialAmount)) {
        return [{ row, score: row.amount * 100 + row.visits, reason: `7日曝光 ${row.exposure} 偏低，但访问 ${row.visits}、金额 ${row.amount.toFixed(2)} 显示有潜力` }];
      }
      return [];
    })
    .sort((a, b) => b.score - a.score);

  return topN(candidates, input.config.topN).map(({ row, reason }) => ({ identifier: identifier(row.platformProductId), action: '曝光优化', reason }));
}

function conversionOptimization(input: AnalyzePublicTrafficInput): PublicTrafficReportSectionItem[] {
  const rules = input.config.conversionOptimization;
  const candidates = input.sevenDaySummary
    .filter((row) => !row.flags.includes('missing'))
    .filter((row) => row.visits >= rules.minVisits && row.exposure >= rules.minExposure && row.amount <= rules.weakAmount)
    .sort((a, b) => b.visits - a.visits || b.exposure - a.exposure);

  return topN(candidates, input.config.topN).map((row) => ({
    identifier: identifier(row.platformProductId),
    action: '转化优化',
    reason: `7日曝光 ${row.exposure}，访问 ${row.visits}，金额 ${row.amount.toFixed(2)}，低于弱成交阈值 ${rules.weakAmount}`,
  }));
}

function newProductObservation(input: AnalyzePublicTrafficInput): PublicTrafficReportSectionItem[] {
  const rules = input.config.newProductObservation;
  const candidates = input.dailyDelta
    .filter((row) => row.flags.includes('new_product'))
    .filter((row) => row.exposure <= rules.lowExposure || (row.exposure <= rules.zeroVisitMaxExposure && row.visits === 0))
    .sort((a, b) => a.exposure - b.exposure || a.visits - b.visits);

  return topN(candidates, input.config.topN).map((row) => ({
    identifier: identifier(row.platformProductId),
    action: '新品观察',
    reason: `新品今日进入公域快照，曝光 ${row.exposure}，访问 ${row.visits}，建议继续观察`,
  }));
}

function lifecycleGovernance(input: AnalyzePublicTrafficInput): PublicTrafficReportSectionItem[] {
  const rules = input.config.lifecycleGovernance;
  const summaryById = new Map(input.thirtyDaySummary.map((row) => [row.platformProductId, row]));
  const candidates = input.cumulativeProducts
    .filter((row) => typeof row.custodyDays === 'number' && row.custodyDays >= rules.minCustodyDays)
    .map((row) => ({ cumulative: row, summary: summaryById.get(row.platformProductId) }))
    .filter(({ summary }) => Boolean(summary && summary.exposure <= rules.weak30dExposure && summary.visits <= rules.weak30dVisits && summary.amount <= rules.weak30dAmount))
    .sort((a, b) => (b.cumulative.custodyDays ?? 0) - (a.cumulative.custodyDays ?? 0) || (a.summary?.exposure ?? 0) - (b.summary?.exposure ?? 0));

  return topN(candidates, input.config.topN).map(({ cumulative, summary }) => ({
    identifier: identifier(cumulative.platformProductId),
    action: '生命周期治理',
    reason: `已托管 ${cumulative.custodyDays} 天，30日曝光 ${summary?.exposure ?? 0}，访问 ${summary?.visits ?? 0}，金额 ${(summary?.amount ?? 0).toFixed(2)}，表现偏弱`,
  }));
}

export function analyzePublicTraffic(input: AnalyzePublicTrafficInput): AnalyzePublicTrafficResult {
  return {
    exposureOptimization: exposureOptimization(input),
    conversionOptimization: conversionOptimization(input),
    newProductObservation: newProductObservation(input),
    lifecycleGovernance: lifecycleGovernance(input),
  };
}
