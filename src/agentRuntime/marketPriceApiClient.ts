export interface PriceMonitorApiClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface PriceMonitorPricingItem {
  product: string;
  merchant: string;
  sku: string;
  deposit?: number | null;
  payableTotal?: number | null;
  rentTotal?: number | null;
  pricesByTerm: Record<string, number>;
}

export interface PriceMonitorPricingSnapshot {
  source: 'price-monitor-api';
  runTs: string;
  capturedAt?: string | null;
  collectedAt: string;
  productFilters: string[];
  count: number;
  items: PriceMonitorPricingItem[];
}

interface PriceMonitorApiPricingResponse {
  run_ts?: unknown;
  captured_at?: unknown;
  count?: unknown;
  pricing?: unknown;
}

const DEFAULT_PRICE_MONITOR_TIMEOUT_MS = 3000;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = parts;
  if (first === 10) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  return false;
}

function isAllowedPriceMonitorHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (isPrivateIpv4(normalized)) return true;
  return normalized.endsWith('.internal') || normalized.endsWith('.local');
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Price Monitor API base URL must use http or https');
  if (!isAllowedPriceMonitorHost(url.hostname)) throw new Error('Price Monitor API base URL host is not allowed');
  return trimTrailingSlash(url.toString());
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function optionalNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringField(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Price Monitor API item missing ${name}`);
  return value;
}

function normalizePrices(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const prices: Record<string, number> = {};
  for (const [term, price] of Object.entries(value)) {
    if (typeof price === 'number' && Number.isFinite(price)) prices[term] = price;
  }
  return prices;
}

function normalizeItem(value: unknown): PriceMonitorPricingItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Price Monitor API pricing item must be an object');
  const item = value as Record<string, unknown>;
  return {
    product: stringField(item.product, 'product'),
    merchant: stringField(item.merchant, 'merchant'),
    sku: stringField(item.sku, 'sku'),
    deposit: optionalNumber(item.deposit),
    payableTotal: optionalNumber(item.payable_total),
    rentTotal: optionalNumber(item.rent_total),
    pricesByTerm: normalizePrices(item.prices),
  };
}

function normalizePricingResponse(value: PriceMonitorApiPricingResponse, productFilters: string[]): PriceMonitorPricingSnapshot {
  if (typeof value.run_ts !== 'string' || value.run_ts.length === 0) throw new Error('Price Monitor API response missing run_ts');
  if (!Array.isArray(value.pricing)) throw new Error('Price Monitor API response missing pricing array');
  const capturedAt = typeof value.captured_at === 'string' || value.captured_at === null ? value.captured_at : undefined;
  const items = value.pricing.map(normalizeItem);
  const count = typeof value.count === 'number' && Number.isFinite(value.count) ? value.count : items.length;
  return {
    source: 'price-monitor-api',
    runTs: value.run_ts,
    capturedAt,
    collectedAt: new Date().toISOString(),
    productFilters,
    count,
    items,
  };
}

export class PriceMonitorApiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: PriceMonitorApiClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_PRICE_MONITOR_TIMEOUT_MS);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async latestPricing(productFilters: string[] = []): Promise<PriceMonitorPricingSnapshot> {
    const snapshots = await Promise.all(productFilters.length > 0 ? productFilters.map((product) => this.fetchLatestPricing([product])) : [this.fetchLatestPricing([])]);
    if (snapshots.length === 1) return snapshots[0];
    const first = snapshots[0];
    return {
      source: 'price-monitor-api',
      runTs: first.runTs,
      capturedAt: first.capturedAt,
      collectedAt: new Date().toISOString(),
      productFilters,
      count: snapshots.reduce((sum, snapshot) => sum + snapshot.count, 0),
      items: snapshots.flatMap((snapshot) => snapshot.items),
    };
  }

  private async fetchLatestPricing(productFilters: string[]): Promise<PriceMonitorPricingSnapshot> {
    const product = productFilters[0];
    const url = new URL(`${this.baseUrl}/api/latest/pricing`);
    if (product) url.searchParams.set('product', product);
    const response = await this.fetchJson(url);
    return normalizePricingResponse(response, productFilters);
  }

  private async fetchJson(url: URL): Promise<PriceMonitorApiPricingResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Price Monitor API ${url.pathname} failed with HTTP ${response.status}`);
      return (await response.json()) as PriceMonitorApiPricingResponse;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createPriceMonitorApiClient(options: PriceMonitorApiClientOptions): PriceMonitorApiClient {
  return new PriceMonitorApiClient(options);
}
