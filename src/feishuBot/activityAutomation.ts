import { readFile } from 'node:fs/promises';
import {
  activityAutomationConfigFromAgentConfig,
  createEmptyDifferentialPricingDraft,
  prepareActivityFormPage,
  type DifferentialPricingDiscountValues,
} from '../activityAutomation/index.js';
import type { ActivitySubmitSession } from '../activityAutomation/submitSession.js';
import { loadConfig } from '../config/loadConfig.js';
import type { FeishuCardPayload } from '../notify/feishuApp.js';

export interface ActivityAutomationExecutionRequest {
  startsAt: string;
  endsAt: string;
  discounts: DifferentialPricingDiscountValues;
}

export interface ActivityPriceCallbackConfirmRequest {
  submitSessionPath: string;
  productIds: string[];
  mappedCount: number;
  startsAt?: string;
  endsAt?: string;
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
  submitSessionPath?: string;
  callbackProductIds?: string[];
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
    placeholder: { tag: 'plain_text', content: `${label} ${options.placeholder}`.trim() },
  };
  if (options.defaultValue !== undefined) input.initial_date = options.defaultValue;
  return input;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringFromRecord(value: unknown, keys: string[]): string | null {
  if (!isRecord(value)) return null;
  const record = value;
  for (const key of keys) {
    const raw = readString(record[key]);
    if (raw) return raw;
  }
  return null;
}

function readDate(value: unknown): string | null {
  const raw = readString(value) ?? readStringFromRecord(value, ['date', 'value', 'formatted_date', 'formattedDate']);
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function readDiscount(value: unknown): string | null {
  const raw = readString(value);
  return raw && /^\d+(?:\.\d+)?$/.test(raw) ? raw : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function hasActivityAutomationFields(value: Record<string, unknown>): boolean {
  return ['starts_at', 'ends_at', 'discount_ss', 'discount_s', 'discount_a', 'discount_b'].some((key) => key in value);
}

function unwrapActivityAutomationFormValue(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  if (hasActivityAutomationFields(value)) return value;
  const nestedForm = value.differential_pricing_form;
  if (isRecord(nestedForm) && hasActivityAutomationFields(nestedForm)) return nestedForm;
  for (const candidate of Object.values(value)) {
    if (isRecord(candidate) && hasActivityAutomationFields(candidate)) return candidate;
  }
  return value;
}

function statusCard(title: string, content: string, template: 'blue' | 'green' | 'red' | 'grey' = 'blue'): FeishuCardPayload {
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: title }, template },
    body: { elements: [{ tag: 'markdown', content }] },
  };
}

function callbackSummaryLines(request: ActivityPriceCallbackConfirmRequest): string[] {
  const preview = request.productIds.slice(0, 10).join(', ');
  return [
    `已映射端内ID: ${request.mappedCount}`,
    ...(request.startsAt && request.endsAt ? [`活动日期: ${request.startsAt} -> ${request.endsAt}`] : []),
    `提交会话: ${request.submitSessionPath}`,
    ...(preview ? [`端内ID预览: ${preview}${request.productIds.length > 10 ? ' ...' : ''}`] : []),
  ];
}

async function readSubmitSessionProductIds(submitSessionPath: string | undefined): Promise<string[]> {
  if (!submitSessionPath) return [];
  try {
    const saved = JSON.parse(await readFile(submitSessionPath, 'utf8')) as ActivitySubmitSession;
    const ids = saved.products
      .map((product) => product.internalProductId?.trim() ?? '')
      .filter((productId) => productId.length > 0);
    return [...new Set(ids)];
  } catch {
    return [];
  }
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
          content: '填写活动日期和折扣档位后确认，机器人会自动打开差异化定价流程、勾选商品、填写日期与折扣，并在最后提交活动。',
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
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '取消' },
              type: 'default',
              form_action_type: 'submit',
              name: 'activity_automation_cancel_submit',
              behaviors: [{ type: 'callback', value: { action: 'activity_automation_cancel' } }],
            },
          ],
        },
      ],
    },
  };
}

export function buildActivityPriceCallbackConfirmCard(request: ActivityPriceCallbackConfirmRequest): FeishuCardPayload {
  const content = [
    '差异化定价已提交完成，是否进入下一阶段的价格回调？',
    ...callbackSummaryLines(request),
  ].join('\n');

  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: '价格回调确认' }, template: 'orange' },
    body: {
      elements: [
        { tag: 'markdown', content },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '确认回调' },
              type: 'primary',
              name: 'activity_price_callback_confirm_submit',
              behaviors: [{ type: 'callback', value: { action: 'activity_price_callback_confirm', request } }],
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '取消' },
              type: 'default',
              name: 'activity_price_callback_cancel_submit',
              behaviors: [{ type: 'callback', value: { action: 'activity_price_callback_cancel', request } }],
            },
          ],
        },
      ],
    },
  };
}

export function buildActivityPriceCallbackStatusCard(
  request: ActivityPriceCallbackConfirmRequest,
  options: { confirmed: boolean },
): FeishuCardPayload {
  return statusCard(
    options.confirmed ? '价格回调已确认' : '价格回调已取消',
    [
      options.confirmed ? '已收到价格回调确认。' : '已取消本次价格回调。',
      ...callbackSummaryLines(request),
    ].join('\n'),
    options.confirmed ? 'green' : 'grey',
  );
}

export function buildActivityPriceCallbackRequest(result: ActivityAutomationExecutionResult): ActivityPriceCallbackConfirmRequest | null {
  if (!result.submitSessionPath) return null;
  const productIds = result.callbackProductIds?.filter((item) => item.trim()) ?? [];
  if (!productIds.length) return null;
  return {
    submitSessionPath: result.submitSessionPath,
    productIds,
    mappedCount: result.mappedCount,
    startsAt: result.request.startsAt,
    endsAt: result.request.endsAt,
  };
}

export function parseActivityAutomationConfirmRequest(formValue: unknown): ActivityAutomationExecutionRequest | null {
  const values = unwrapActivityAutomationFormValue(formValue);
  if (!values) return null;
  const startsAt = readDate(values.starts_at);
  const endsAt = readDate(values.ends_at);
  const SS = readDiscount(values.discount_ss) ?? DEFAULT_DISCOUNTS.SS;
  const S = readDiscount(values.discount_s) ?? DEFAULT_DISCOUNTS.S;
  const A = readDiscount(values.discount_a) ?? DEFAULT_DISCOUNTS.A;
  const B = readDiscount(values.discount_b) ?? DEFAULT_DISCOUNTS.B;
  if (!startsAt || !endsAt || !SS || !S || !A || !B) return null;
  return { startsAt, endsAt, discounts: { SS, S, A, B } };
}

export function parseActivityPriceCallbackConfirmRequest(value: unknown): ActivityPriceCallbackConfirmRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const source = typeof record.request === 'object' && record.request !== null && !Array.isArray(record.request)
    ? record.request as Record<string, unknown>
    : record;
  const submitSessionPath = readString(source.submitSessionPath);
  const productIds = readStringArray(source.productIds);
  const mappedCountRaw = source.mappedCount;
  const mappedCount = typeof mappedCountRaw === 'number'
    ? mappedCountRaw
    : typeof mappedCountRaw === 'string' && mappedCountRaw.trim()
      ? Number(mappedCountRaw)
      : Number.NaN;
  if (!submitSessionPath || !productIds.length || !Number.isFinite(mappedCount)) return null;
  const startsAt = readDate(source.startsAt) ?? undefined;
  const endsAt = readDate(source.endsAt) ?? undefined;
  return { submitSessionPath, productIds, mappedCount, startsAt, endsAt };
}

export function formatActivityAutomationExecutionResult(result: ActivityAutomationExecutionResult): string {
  return [
    result.ok ? '差异化定价执行完成' : '差异化定价执行失败',
    ...result.lines,
    ...(result.productPickSessionPath ? [`勾选记录: ${result.productPickSessionPath}`] : []),
    ...(result.submitSessionPath ? [`价格回调交接: ${result.submitSessionPath}`] : []),
  ].join('\n');
}

export function createActivityAutomationSkillClient(): ActivityAutomationSkillClient {
  return {
    async execute(request) {
      const agentConfig = await loadConfig();
      const config = activityAutomationConfigFromAgentConfig(agentConfig, {
        keepBrowserOnFailure: process.env.MT_AGENT_KEEP_BROWSER_ON_FAILURE !== '0',
        confirmSubmit: true,
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
      const callbackProductIds = await readSubmitSessionProductIds(result.submitSessionPath);
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
        submitSessionPath: result.submitSessionPath,
        callbackProductIds,
        lines: [
          `自动选品: ${result.productPickResult?.selectedCount ?? 0}`,
          `活动时间填写: ${result.dateFillResult?.filledCount ?? 0}`,
          `折扣填写: ${result.discountFillResult?.filledCount ?? 0}`,
          `活动提交: ${result.submitResult ? '已完成' : '未开启'}`,
          `已映射端内ID: ${result.productPickSession?.mappedCount ?? 0}`,
          `未映射端内ID: ${result.productPickSession?.unmappedCount ?? 0}`,
        ],
      };
    },
  };
}
