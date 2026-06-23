import { join } from 'node:path';
import type { AgentConfig } from '../domain/types.js';
import { createEmptyDifferentialPricingDraft, type DifferentialPricingDraft } from './differentialPricing.js';

export const ALIPAY_ACTIVITY_APP_ID = '2021005181665859';
export const ALIPAY_ACTIVITY_PRODUCT_CODE = 'PROMO_ZHIMA_REDUCTION';
export const ALIPAY_ACTIVITY_FORM_URL = `https://b.alipay.com/page/commodity-operation/activity/activityForm?appId=${ALIPAY_ACTIVITY_APP_ID}&productCode=${ALIPAY_ACTIVITY_PRODUCT_CODE}`;

export interface ActivityAutomationConfig {
  targetUrl: string;
  outputDir: string;
  browserProfileDir: string;
  productIdMappingPath?: string;
  headless: boolean;
  keepBrowserOnFailure: boolean;
  pickProducts: boolean;
  fillDiscounts: boolean;
  draft: DifferentialPricingDraft;
}

export interface ActivityAutomationCliOptions {
  headless?: boolean;
  keepBrowserOnFailure?: boolean;
  pickProducts?: boolean;
  fillDiscounts?: boolean;
  draft?: DifferentialPricingDraft;
}

export function activityAutomationOutputDir(config: Pick<ActivityAutomationConfig, 'outputDir'>): string {
  return join(config.outputDir, 'latest', 'activity-automation');
}

export function activityAutomationConfigFromAgentConfig(agentConfig: AgentConfig, options: ActivityAutomationCliOptions = {}): ActivityAutomationConfig {
  return {
    targetUrl: ALIPAY_ACTIVITY_FORM_URL,
    outputDir: agentConfig.outputDir,
    browserProfileDir: agentConfig.browserProfileDir,
    productIdMappingPath: agentConfig.productIdMappingPath,
    headless: options.headless ?? false,
    keepBrowserOnFailure: options.keepBrowserOnFailure ?? true,
    pickProducts: options.pickProducts ?? false,
    fillDiscounts: options.fillDiscounts ?? true,
    draft: options.draft ?? createEmptyDifferentialPricingDraft(),
  };
}
