import type { ActivityControlSummary } from './pageModel.js';

export type DifferentialPricingSignalKey = 'activity_name' | 'product_selection' | 'pricing_rule' | 'time_range';

export interface DifferentialPricingScoutSignal {
  key: DifferentialPricingSignalKey;
  label: string;
  present: boolean;
  evidence: string[];
}

export interface DifferentialPricingSelectedProduct {
  rowKey: string;
  name: string;
  merchantProductId: string;
}

export interface DifferentialPricingScoutAnalysis {
  safeAutomationStage: 'scout_only';
  requiredSignals: DifferentialPricingScoutSignal[];
  selectedProductCount: number;
  selectedProducts: DifferentialPricingSelectedProduct[];
  mutatingControlCount: number;
  mutatingControls: string[];
  detectedWorkarounds: string[];
  nextSteps: string[];
}

export interface DifferentialPricingScoutAnalysisInput {
  controls: ActivityControlSummary[];
  bodyText: string;
  detectedWorkarounds: string[];
  selectedProductRows: DifferentialPricingSelectedProduct[];
}

const signalDefinitions: Array<{ key: DifferentialPricingSignalKey; label: string; patterns: RegExp[] }> = [
  { key: 'activity_name', label: '活动名称', patterns: [/活动名称/, /活动标题/] },
  { key: 'product_selection', label: '商品选择', patterns: [/选择商品/, /商品范围/, /商品ID/, /商品名称/] },
  { key: 'pricing_rule', label: '定价规则', patterns: [/优惠金额/, /差异化定价/, /价格/, /减免/, /折扣/] },
  { key: 'time_range', label: '活动时间', patterns: [/活动时间/, /开始时间/, /结束时间/, /有效期/] },
];

function normalized(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function evidenceFor(patterns: RegExp[], controls: ActivityControlSummary[], bodyText: string): string[] {
  const evidence = new Set<string>();
  for (const control of controls) {
    const text = normalized(control.text);
    if (text && patterns.some((pattern) => pattern.test(text))) evidence.add(text);
  }
  const compactBody = normalized(bodyText);
  for (const pattern of patterns) {
    const match = compactBody.match(pattern);
    if (match?.[0]) evidence.add(match[0]);
  }
  return Array.from(evidence).slice(0, 5);
}

function selectedProductCountFrom(bodyText: string): number {
  const match = bodyText.match(/已选(\d+)个商品/);
  return match ? Number(match[1]) : 0;
}

export function analyzeDifferentialPricingScout(input: DifferentialPricingScoutAnalysisInput): DifferentialPricingScoutAnalysis {
  const requiredSignals = signalDefinitions.map((definition) => {
    const evidence = evidenceFor(definition.patterns, input.controls, input.bodyText);
    return { key: definition.key, label: definition.label, present: evidence.length > 0, evidence };
  });
  const selectedProducts = input.selectedProductRows;
  const mutatingControls = input.controls.filter((control) => control.mutating).map((control) => normalized(control.text)).filter(Boolean);
  const missingLabels = requiredSignals.filter((signal) => !signal.present).map((signal) => signal.label);

  return {
    safeAutomationStage: 'scout_only',
    requiredSignals,
    selectedProductCount: selectedProductCountFrom(input.bodyText),
    selectedProducts,
    mutatingControlCount: mutatingControls.length,
    mutatingControls,
    detectedWorkarounds: input.detectedWorkarounds,
    nextSteps: [
      missingLabels.length > 0 ? `缺少页面信号：${missingLabels.join('、')}。请先确认页面是否加载到差异化定价表单。` : '页面核心信号已出现，可进入人工录制字段定位。',
      '基于控件清单录制字段定位，不要自动点击提交类控件。',
    ],
  };
}
