import type {
  Level,
  PeriodKey,
  PeriodProductMetrics,
  ProductAnalysisRow,
  ProductMetrics,
  RecommendationAction,
} from '../domain/types.js';

const HIGH_CONFIDENCE_30D_VISITS = 150;
const MEDIUM_CONFIDENCE_30D_VISITS = 30;
const LOW_EXPOSURE_VISITS = 100;
const HIGH_VISITS = 300;
const INACTIVE_30D_VISITS = 150;

function createEmptyMetrics(): Record<PeriodKey, ProductMetrics | null> {
  return {
    '1d': null,
    '7d': null,
    '30d': null,
  };
}

function levelFromScore(score: number): Level {
  if (score >= 70) return '高';
  if (score >= 35) return '中';
  return '低';
}

function shippedRate(metrics: ProductMetrics | null): number {
  if (!metrics || metrics.visits <= 0) {
    return 0;
  }

  return metrics.shippedOrders / metrics.visits;
}

function hasOrderSignal(metrics: ProductMetrics | null): boolean {
  return Boolean(metrics && (metrics.createdOrders > 0 || metrics.signedOrders > 0 || metrics.reviewedOrders > 0));
}

function chooseConfidence(metrics: Record<PeriodKey, ProductMetrics | null>): Level {
  const thirty = metrics['30d'];
  const seven = metrics['7d'];
  const one = metrics['1d'];

  if (thirty && thirty.visits >= HIGH_CONFIDENCE_30D_VISITS && seven && one) {
    return '高';
  }

  if (thirty && thirty.visits >= MEDIUM_CONFIDENCE_30D_VISITS) {
    return '中';
  }

  return '低';
}

function buildReason(metrics: Record<PeriodKey, ProductMetrics | null>, action: RecommendationAction): string {
  const one = metrics['1d'];
  const seven = metrics['7d'];
  const thirty = metrics['30d'];
  const parts = [
    `1天访问${one?.visits ?? 0}，发货${one?.shippedOrders ?? 0}`,
    `7天访问${seven?.visits ?? 0}，发货${seven?.shippedOrders ?? 0}`,
    `30天访问${thirty?.visits ?? 0}，发货${thirty?.shippedOrders ?? 0}`,
  ];

  if (action === '疑似失活') {
    return `${parts.join('；')}；30天访问超过150但发货为0，建议检查链接是否失活、库存或页面问题。`;
  }

  if (action === '疑似价格问题') {
    return `${parts.join('；')}；30天有创建/签约/审出订单信号，但7天发货为0，优先检查价格、库存和履约竞争力。`;
  }

  if (action === '建议补链') {
    return `${parts.join('；')}；低曝光下已有发货信号，建议增加同款链接或曝光。`;
  }

  if (action === '建议加曝光') {
    return `${parts.join('；')}；转化表现可用，建议增加曝光。`;
  }

  if (action === '高曝光低转化') {
    return `${parts.join('；')}；访问较高但转化弱，检查价格、主图、标题和库存。`;
  }

  if (action === '稳定优质') {
    return `${parts.join('；')}；多个周期有稳定发货信号。`;
  }

  return `${parts.join('；')}；当前信号不够明确，继续观察。`;
}

function analyzeOne(
  productName: string,
  platformProductId: string,
  metrics: Record<PeriodKey, ProductMetrics | null>,
): ProductAnalysisRow {
  const one = metrics['1d'];
  const seven = metrics['7d'];
  const thirty = metrics['30d'];
  const sevenLowExposureWithShipment = (seven?.visits ?? Number.POSITIVE_INFINITY) < LOW_EXPOSURE_VISITS && (seven?.shippedOrders ?? 0) > 0;

  let action: RecommendationAction = '继续观察';
  let riskScore = 10;
  let opportunityScore = 10;

  if (thirty && hasOrderSignal(thirty) && (seven?.shippedOrders ?? 0) === 0) {
    action = '疑似价格问题';
    riskScore = 80;
    opportunityScore = 35;
  } else if ((seven?.visits ?? 0) >= HIGH_VISITS && shippedRate(seven) < 0.01) {
    action = '高曝光低转化';
    riskScore = 75;
    opportunityScore = 25;
  } else if (sevenLowExposureWithShipment) {
    action = '建议补链';
    opportunityScore = 85;
    riskScore = 15;
  } else if (shippedRate(seven) > 0.02 || shippedRate(thirty) > 0.02) {
    action = '建议加曝光';
    riskScore = 10;
    opportunityScore = 60;
  } else if (thirty && thirty.visits > INACTIVE_30D_VISITS && thirty.shippedOrders === 0) {
    action = '疑似失活';
    riskScore = 85;
    opportunityScore = 5;
  } else if ((one?.shippedOrders ?? 0) > 0 && (seven?.shippedOrders ?? 0) > 0 && (thirty?.shippedOrders ?? 0) > 0) {
    action = '稳定优质';
    riskScore = 5;
    opportunityScore = 70;
  }

  const reference = one ?? seven ?? thirty;

  return {
    productName,
    platformProductId,
    spuName: reference?.spuName,
    spuId: reference?.spuId,
    metrics,
    riskScore,
    opportunityScore,
    riskLevel: levelFromScore(riskScore),
    opportunityLevel: levelFromScore(opportunityScore),
    action,
    confidence: chooseConfidence(metrics),
    reason: buildReason(metrics, action),
  };
}

export function analyzeProducts(rows: PeriodProductMetrics[]): ProductAnalysisRow[] {
  const grouped = new Map<string, { productName: string; metrics: Record<PeriodKey, ProductMetrics | null> }>();

  for (const row of rows) {
    const existing = grouped.get(row.platformProductId) ?? {
      productName: row.productName,
      metrics: createEmptyMetrics(),
    };

    existing.productName = existing.productName || row.productName;
    existing.metrics[row.period] = row;
    grouped.set(row.platformProductId, existing);
  }

  return Array.from(grouped.entries())
    .map(([platformProductId, value]) => analyzeOne(value.productName, platformProductId, value.metrics))
    .sort((left, right) => {
      const actionPriority: Record<RecommendationAction, number> = {
        疑似价格问题: 1,
        高曝光低转化: 2,
        建议补链: 3,
        建议加曝光: 4,
        疑似失活: 5,
        稳定优质: 6,
        继续观察: 7,
      };
      return actionPriority[left.action] - actionPriority[right.action] || right.riskScore + right.opportunityScore - (left.riskScore + left.opportunityScore);
    });
}
