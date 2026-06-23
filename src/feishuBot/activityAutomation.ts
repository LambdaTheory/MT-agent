import { activityAutomationConfigFromAgentConfig, createEmptyDifferentialPricingDraft, prepareActivityFormPage, type DifferentialPricingDiscountValues } from '../activityAutomation/index.js';
import { loadConfig } from '../config/loadConfig.js';
import type { FeishuCardPayload } from '../notify/feishuApp.js';

export interface ActivityAutomationExecutionRequest {
  startsAt: string;
  endsAt: string;
  discounts: DifferentialPricingDiscountValues;
}

export interface ActivityAutomationExecutionResult {
  ok: boolean;
  request: ActivityAutomationExecutionRequest;
  selectedCount: number;
  pagesVisited: number;
  dateFilledCount: number;
  discountFilledCount: number;
  mappedCount: number;
  unmappedCount: number;
  productPickSessionPath?: string;
  lines: string[];
}

export interface ActivityAutomationSkillClient {
  execute(request: ActivityAutomationExecutionRequest): Promise<ActivityAutomationExecutionResult>;
}

const DEFAULT_DISCOUNTS: DifferentialPricingDiscountValues = {
  SS: '8.5',
  S: '9.0',
  A: '9.5',
  B: '9.8',
};

function textInput(name: string, label: string, options: { defaultValue?: string; placeholder: string }): Record<string, unknown> {
  const input: Record<string, unknown> = {
    tag: 'input',
    name,
    label: { tag: 'plain_text', content: label },
    label_position: 'top',
    input_type: 'text',
    placeholder: { tag: 'plain_text', content: options.placeholder },
  };
  if (options.defaultValue !== undefined) input.default_value = options.defaultValue;
  return input;
}

function datePicker(name: string, label: string, options: { defaultValue?: string; placeholder: string }): Record<string, unknown> {
  const input: Record<string, unknown> = {
    tag: 'date_picker',
    name,
    label: { tag: 'plain_text', content: label },
    label_position: 'top',
    placeholder: { tag: 'plain_text', content: options.placeholder },
  };
  if (options.defaultValue !== undefined) input.initial_date = options.defaultValue;
  return input;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readDate(value: unknown): string | null {
  const raw = readString(value);
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function readDiscount(value: unknown): string | null {
  const raw = readString(value);
  return raw && /^\d+(?:\.\d+)?$/.test(raw) ? raw : null;
}

export function buildActivityAutomationCard(defaults: Partial<ActivityAutomationExecutionRequest> = {}): FeishuCardPayload {
  const discounts = { ...DEFAULT_DISCOUNTS, ...defaults.discounts };
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: '差异化定价' }, template: 'blue' },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: '填写活动日期和折扣档位后确认，机器人会自动打开差异化定价流程、勾选商品并填写内容，但不会提交活动。',
        },
        {
          tag: 'form',
          name: 'differential_pricing_form',
          elements: [
            datePicker('starts_at', '开始日期', {
              defaultValue: defaults.startsAt,
              placeholder: 'YYYY-MM-DD',
            }),
            datePicker('ends_at', '结束日期', {
              defaultValue: defaults.endsAt,
              placeholder: 'YYYY-MM-DD',
            }),
            textInput('discount_ss', 'SS 折扣', {
              defaultValue: discounts.SS,
              placeholder: '例如 8.5',
            }),
            textInput('discount_s', 'S 折扣', {
              defaultValue: discounts.S,
              placeholder: '例如 9.0',
            }),
            textInput('discount_a', 'A 折扣', {
              defaultValue: discounts.A,
              placeholder: '例如 9.5',
            }),
            textInput('discount_b', 'B 折扣', {
              defaultValue: discounts.B,
              placeholder: '例如 9.8',
            }),
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '开始执行' },
              type: 'primary',
              form_action_type: 'submit',
              name: 'activity_automation_confirm_submit',
              behaviors: [{ type: 'callback', value: { action: 'activity_automation_confirm' } }],
            },
          ],
        },
      ],
    },
  };
}

export function parseActivityAutomationConfirmRequest(formValue: unknown): ActivityAutomationExecutionRequest | null {
  if (!formValue || typeof formValue !== 'object' || Array.isArray(formValue)) return null;
  const values = formValue as Record<string, unknown>;
  const startsAt = readDate(values.starts_at);
  const endsAt = readDate(values.ends_at);
  const SS = readDiscount(values.discount_ss);
  const S = readDiscount(values.discount_s);
  const A = readDiscount(values.discount_a);
  const B = readDiscount(values.discount_b);
  if (!startsAt || !endsAt || !SS || !S || !A || !B) return null;
  return { startsAt, endsAt, discounts: { SS, S, A, B } };
}

export function formatActivityAutomationExecutionResult(result: ActivityAutomationExecutionResult): string {
  return [
    result.ok ? '差异化定价执行完成' : '差异化定价执行失败',
    ...result.lines,
    ...(result.productPickSessionPath ? [`勾选记录: ${result.productPickSessionPath}`] : []),
  ].join('\n');
}

export function createActivityAutomationSkillClient(): ActivityAutomationSkillClient {
  return {
    async execute(request) {
      const agentConfig = await loadConfig();
      const config = activityAutomationConfigFromAgentConfig(agentConfig, {
        keepBrowserOnFailure: process.env.MT_AGENT_KEEP_BROWSER_ON_FAILURE !== '0',
        pickProducts: true,
        fillDiscounts: true,
        draft: {
          ...createEmptyDifferentialPricingDraft(),
          startsAt: request.startsAt,
          endsAt: request.endsAt,
          discounts: request.discounts,
        },
      });
      const result = await prepareActivityFormPage(config);
      return {
        ok: true,
        request,
        selectedCount: result.productPickResult?.selectedCount ?? result.analysis.selectedProductCount,
        pagesVisited: result.productPickResult?.pagesVisited ?? 0,
        dateFilledCount: result.dateFillResult?.filledCount ?? 0,
        discountFilledCount: result.discountFillResult?.filledCount ?? 0,
        mappedCount: result.productPickSession?.mappedCount ?? 0,
        unmappedCount: result.productPickSession?.unmappedCount ?? 0,
        productPickSessionPath: result.productPickSessionPath,
        lines: [
          `自动选品: ${result.productPickResult?.selectedCount ?? 0}`,
          `活动时间填写: ${result.dateFillResult?.filledCount ?? 0}`,
          `折扣填写: ${result.discountFillResult?.filledCount ?? 0}`,
          `已映射端内ID: ${result.productPickSession?.mappedCount ?? 0}`,
          `未映射端内ID: ${result.productPickSession?.unmappedCount ?? 0}`,
        ],
      };
    },
  };
}
