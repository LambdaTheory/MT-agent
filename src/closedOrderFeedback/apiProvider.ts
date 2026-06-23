import type {
  ClosedOrderFeedbackInput,
  ClosedOrderFeedbackRecentProvider,
  ClosedOrderRemarkRecord,
  ClosedOrderRemarksResponse,
} from './types.js';

export interface ClosedOrderFeedbackApiEnv {
  CLOSED_ORDER_REMARKS_BASE_URL?: string;
  CLOSED_ORDER_REMARKS_API_TOKEN?: string;
  CLOSED_ORDER_REMARKS_SOURCE_APP_CODE?: string;
}

function requireNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid closed order remarks field: ${name}`);
  }
  return value.trim();
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseRemarkRecord(value: unknown): ClosedOrderRemarkRecord {
  if (!isObject(value)) throw new Error('Invalid closed order remarks item: expected object');
  return {
    id: requireNonEmptyString(value.id, 'id'),
    orderNo: requireNonEmptyString(value.order_no, 'order_no'),
    internalProductId: requireNonEmptyString(value.goods_id, 'goods_id'),
    merchant: requireNonEmptyString(value.merchant, 'merchant'),
    merchantRemark: requireNonEmptyString(value.merchant_remark, 'merchant_remark'),
    capturedAt: requireNonEmptyString(value.captured_at, 'captured_at'),
    receivedAt: requireNonEmptyString(value.received_at, 'received_at'),
  };
}

export function parseClosedOrderRemarksResponse(value: unknown): ClosedOrderRemarksResponse {
  if (!isObject(value)) throw new Error('Invalid closed order remarks response: expected object');
  if (!Array.isArray(value.items)) throw new Error('Invalid closed order remarks response: items must be an array');
  return {
    sourceAppCode: requireNonEmptyString(value.source_app_code, 'source_app_code'),
    items: value.items.map(parseRemarkRecord),
  };
}

export function mapClosedOrderRemarkToFeedbackInput(item: ClosedOrderRemarkRecord): ClosedOrderFeedbackInput {
  return {
    closeId: item.id,
    closedAt: item.capturedAt,
    orderNo: item.orderNo,
    merchant: item.merchant,
    internalProductId: item.internalProductId,
    rawRemark: item.merchantRemark,
  };
}

export class ClosedOrderFeedbackApiProvider implements ClosedOrderFeedbackRecentProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly apiToken: string,
    private readonly sourceAppCode: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async listRecentFeedback(limit = 20): Promise<ClosedOrderFeedbackInput[]> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error(`Invalid closed order remarks limit: ${limit}`);
    }

    const url = new URL(`${normalizeBaseUrl(this.baseUrl)}/api/platform/closed-order-remarks/recent`);
    url.searchParams.set('source_app_code', this.sourceAppCode);
    url.searchParams.set('limit', String(limit));

    const response = await this.fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
      },
    });
    if (!response.ok) {
      throw new Error(`Closed order remarks API request failed: ${response.status} ${response.statusText}`);
    }

    const payload = parseClosedOrderRemarksResponse(await response.json());
    return payload.items.map(mapClosedOrderRemarkToFeedbackInput);
  }
}

export function createClosedOrderFeedbackApiProviderFromEnv(
  env: ClosedOrderFeedbackApiEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): ClosedOrderFeedbackApiProvider | null {
  const baseUrl = env.CLOSED_ORDER_REMARKS_BASE_URL?.trim();
  const apiToken = env.CLOSED_ORDER_REMARKS_API_TOKEN?.trim();
  const sourceAppCode = env.CLOSED_ORDER_REMARKS_SOURCE_APP_CODE?.trim();
  if (!baseUrl || !apiToken || !sourceAppCode) return null;
  return new ClosedOrderFeedbackApiProvider(baseUrl, apiToken, sourceAppCode, fetchImpl);
}
