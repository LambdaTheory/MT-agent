import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runClosedOrderPriceAlertPoll } from '../src/closedOrderFeedback/priceAlertMonitor.js';
import { createLinkRegistryQuery } from '../src/linkRegistry/queryRegistry.js';
import type { ClosedOrderRegistryContext } from '../src/closedOrderFeedback/runtime.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';

const registryEntries: LinkRegistryEntry[] = [
  {
    internalProductId: '560',
    platformProductId: 'platform-560',
    productName: 'Pocket 3 全能套装',
    shortName: 'Pocket 3',
    sameSkuGroupId: 'dji-pocket-3',
    status: 'active',
    source: ['product_id_mapping'],
  },
];

function createRegistryContext(): ClosedOrderRegistryContext {
  return {
    registry: registryEntries,
    query: createLinkRegistryQuery(registryEntries),
    productIdMapping: { 'platform-560': '560' },
    overrideRisks: [],
    resolvedPaths: {
      productIdMapPath: 'config/product-id-map.json',
      productNameMapPath: 'config/product-name-map.json',
      goodsSnapshotPath: 'output/state/goods-current-snapshot.json',
      firstSeenPath: 'output/state/goods-first-seen.json',
      lifecyclePath: 'output/state/goods-link-lifecycle.json',
      daemonCatalogPath: 'output/state/link-registry-daemon-catalog.json',
      overridesPath: 'config/link-registry-overrides.json',
      artifactsDir: 'output',
    },
  };
}

async function tempOutputDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'mt-agent-closed-order-price-alert-'));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('closed order price alert monitor', () => {
  it('sends a Feishu alert only for newly discovered pricing remarks', async () => {
    const outputDir = await tempOutputDir();
    const sendCard = vi.fn(async () => ({ sent: true as const, channel: 'app' as const }));
    const loadRegistryContext = vi.fn(async () => createRegistryContext());
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      source_app_code: 'order_dispatch',
      items: [
        {
          id: 'close-1',
          order_no: 'SH202606290001',
          goods_id: '560',
          merchant: 'merchant-A',
          merchant_remark: '价格太低，商家不接',
          captured_at: '2026-06-29T01:00:00Z',
          received_at: '2026-06-29T01:01:00Z',
        },
        {
          id: 'close-2',
          order_no: 'SH202606290002',
          goods_id: '560',
          merchant: 'merchant-A',
          merchant_remark: '联系不上客户',
          captured_at: '2026-06-29T01:05:00Z',
          received_at: '2026-06-29T01:06:00Z',
        },
      ],
    }), { status: 200 }));

    try {
      const result = await runClosedOrderPriceAlertPoll({
        env: {
          CLOSED_ORDER_REMARKS_BASE_URL: 'https://hub.leejh.cyou',
          CLOSED_ORDER_REMARKS_API_TOKEN: 'secret-token',
          CLOSED_ORDER_REMARKS_SOURCE_APP_CODE: 'order_dispatch',
          CLOSED_ORDER_PRICE_ALERT_FEISHU_SEND_TO: 'group',
          FEISHU_SEND_TO: 'personal',
        },
        outputDir,
        fetchImpl: fetchImpl as typeof fetch,
        sendCard,
        loadRegistryContext,
      });

      expect(result).toMatchObject({
        fetchedCount: 2,
        addedCount: 2,
        updatedCount: 0,
        pricingCount: 1,
        sent: true,
      });
      expect(loadRegistryContext).toHaveBeenCalledOnce();
      expect(sendCard).toHaveBeenCalledOnce();
      const firstCall = sendCard.mock.calls[0] as unknown as [Record<string, unknown>, unknown, string];
      const [sendEnv, , fallbackText] = firstCall;
      expect(sendEnv).toEqual(expect.objectContaining({ FEISHU_SEND_TO: 'group' }));
      expect(fallbackText).toContain('关单价格提醒');
      expect(fetchImpl).toHaveBeenCalledOnce();
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('does not send duplicate alerts on a second poll with the same data', async () => {
    const outputDir = await tempOutputDir();
    const sendCard = vi.fn(async () => ({ sent: true as const, channel: 'app' as const }));
    const loadRegistryContext = vi.fn(async () => createRegistryContext());
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      source_app_code: 'order_dispatch',
      items: [
        {
          id: 'close-1',
          order_no: 'SH202606290001',
          goods_id: '560',
          merchant: 'merchant-A',
          merchant_remark: '价格太高，商家不愿意出',
          captured_at: '2026-06-29T01:00:00Z',
          received_at: '2026-06-29T01:01:00Z',
        },
      ],
    }), { status: 200 }));

    try {
      await runClosedOrderPriceAlertPoll({
        env: {
          CLOSED_ORDER_REMARKS_BASE_URL: 'https://hub.leejh.cyou',
          CLOSED_ORDER_REMARKS_API_TOKEN: 'secret-token',
          CLOSED_ORDER_REMARKS_SOURCE_APP_CODE: 'order_dispatch',
        },
        outputDir,
        fetchImpl: fetchImpl as typeof fetch,
        sendCard,
        loadRegistryContext,
      });

      const second = await runClosedOrderPriceAlertPoll({
        env: {
          CLOSED_ORDER_REMARKS_BASE_URL: 'https://hub.leejh.cyou',
          CLOSED_ORDER_REMARKS_API_TOKEN: 'secret-token',
          CLOSED_ORDER_REMARKS_SOURCE_APP_CODE: 'order_dispatch',
        },
        outputDir,
        fetchImpl: fetchImpl as typeof fetch,
        sendCard,
        loadRegistryContext,
      });

      expect(second).toMatchObject({
        fetchedCount: 1,
        addedCount: 0,
        updatedCount: 1,
        pricingCount: 0,
        sent: false,
      });
      expect(sendCard).toHaveBeenCalledTimes(1);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('skips delivery when there are no pricing remarks in new records', async () => {
    const outputDir = await tempOutputDir();
    const sendCard = vi.fn(async () => ({ sent: true as const, channel: 'app' as const }));
    const loadRegistryContext = vi.fn(async () => createRegistryContext());
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      source_app_code: 'order_dispatch',
      items: [
        {
          id: 'close-3',
          order_no: 'SH202606290003',
          goods_id: '560',
          merchant: 'merchant-A',
          merchant_remark: '客户联系不上',
          captured_at: '2026-06-29T02:00:00Z',
          received_at: '2026-06-29T02:01:00Z',
        },
      ],
    }), { status: 200 }));

    try {
      const result = await runClosedOrderPriceAlertPoll({
        env: {
          CLOSED_ORDER_REMARKS_BASE_URL: 'https://hub.leejh.cyou',
          CLOSED_ORDER_REMARKS_API_TOKEN: 'secret-token',
          CLOSED_ORDER_REMARKS_SOURCE_APP_CODE: 'order_dispatch',
        },
        outputDir,
        fetchImpl: fetchImpl as typeof fetch,
        sendCard,
        loadRegistryContext,
      });

      expect(result).toMatchObject({
        fetchedCount: 1,
        addedCount: 1,
        pricingCount: 0,
        sent: false,
      });
      expect(loadRegistryContext).not.toHaveBeenCalled();
      expect(sendCard).not.toHaveBeenCalled();
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('gracefully skips when the closed order API env is missing', async () => {
    const outputDir = await tempOutputDir();
    const sendCard = vi.fn(async () => ({ sent: true as const, channel: 'app' as const }));

    try {
      const result = await runClosedOrderPriceAlertPoll({
        env: {},
        outputDir,
        sendCard,
      });

      expect(result).toEqual({
        fetchedCount: 0,
        addedCount: 0,
        updatedCount: 0,
        pricingCount: 0,
        sent: false,
        skippedReason: 'missing_api_env',
      });
      expect(sendCard).not.toHaveBeenCalled();
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
