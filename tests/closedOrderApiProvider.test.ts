import { describe, expect, it, vi } from 'vitest';
import {
  ClosedOrderFeedbackApiProvider,
  createClosedOrderFeedbackApiProviderFromEnv,
  mapClosedOrderRemarkToFeedbackInput,
  parseClosedOrderRemarksResponse,
} from '../src/closedOrderFeedback/apiProvider.js';

describe('closed order API provider', () => {
  it('parses and maps closed order remarks response payloads', () => {
    const response = parseClosedOrderRemarksResponse({
      source_app_code: 'order_dispatch',
      items: [
        {
          id: 'close-1',
          order_no: 'SH202606220001',
          goods_id: '560',
          merchant: 'merchant-A',
          merchant_remark: 'cannot reach customer',
          captured_at: '2026-06-20T11:57:42Z',
          received_at: '2026-06-22T03:55:57.917120Z',
        },
      ],
    });

    expect(response).toEqual({
      sourceAppCode: 'order_dispatch',
      items: [
        {
          id: 'close-1',
          orderNo: 'SH202606220001',
          internalProductId: '560',
          merchant: 'merchant-A',
          merchantRemark: 'cannot reach customer',
          capturedAt: '2026-06-20T11:57:42Z',
          receivedAt: '2026-06-22T03:55:57.917120Z',
        },
      ],
    });
    expect(mapClosedOrderRemarkToFeedbackInput(response.items[0])).toEqual({
      closeId: 'close-1',
      closedAt: '2026-06-20T11:57:42Z',
      orderNo: 'SH202606220001',
      merchant: 'merchant-A',
      internalProductId: '560',
      rawRemark: 'cannot reach customer',
    });
  });

  it('requests recent remarks with bearer auth and query params', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({
        source_app_code: 'order_dispatch',
        items: [
          {
            id: 'close-1',
            order_no: 'SH202606220001',
            goods_id: '560',
            merchant: 'merchant-A',
            merchant_remark: 'cannot reach customer',
            captured_at: '2026-06-20T11:57:42Z',
            received_at: '2026-06-22T03:55:57.917120Z',
          },
        ],
      }), { status: 200 }),
    );

    const provider = new ClosedOrderFeedbackApiProvider('https://hub.leejh.cyou', 'secret-token', 'order_dispatch', fetchImpl);
    const items = await provider.listRecentFeedback(5);

    expect(items).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('https://hub.leejh.cyou/api/platform/closed-order-remarks/recent?source_app_code=order_dispatch&limit=5');
    expect(init.headers).toEqual({ Authorization: 'Bearer secret-token' });
  });

  it('creates provider from env only when required fields are present', () => {
    expect(createClosedOrderFeedbackApiProviderFromEnv({
      CLOSED_ORDER_REMARKS_BASE_URL: 'https://hub.leejh.cyou',
      CLOSED_ORDER_REMARKS_API_TOKEN: 'secret-token',
      CLOSED_ORDER_REMARKS_SOURCE_APP_CODE: 'order_dispatch',
    })).toBeInstanceOf(ClosedOrderFeedbackApiProvider);
    expect(createClosedOrderFeedbackApiProviderFromEnv({
      CLOSED_ORDER_REMARKS_BASE_URL: 'https://hub.leejh.cyou',
      CLOSED_ORDER_REMARKS_API_TOKEN: '',
      CLOSED_ORDER_REMARKS_SOURCE_APP_CODE: 'order_dispatch',
    })).toBeNull();
  });
});
