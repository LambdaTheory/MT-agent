export interface FetchRecentGoodsManagerProductIdsOptions {
  baseUrl: string;
  days?: number;
  referenceDate: string;
  fetchImpl?: typeof fetch;
  pageSize?: number;
  requireAlipaySynced?: boolean;
}

export type FetchRecentGoodsManagerProductsOptions = FetchRecentGoodsManagerProductIdsOptions;

export interface GoodsManagerNewProductPoolItem {
  productId: string;
  productName: string;
  shortTitle: string;
  submittedAt: string;
  merchant: string;
  alipaySyncStatus: string;
  alipayCode: string;
  stock: number;
  skuCount: number;
  maintenanceStatus: '待维护';
  note: '';
}

interface GoodsManagerGoodsItem {
  ID?: unknown;
  商品名称?: unknown;
  短标题?: unknown;
  最近提交时间?: unknown;
  merchant?: unknown;
  商家?: unknown;
  是否同步支付宝?: unknown;
  支付宝编码?: unknown;
  库存?: unknown;
  skus?: unknown;
}

interface GoodsManagerGoodsResponse {
  data?: GoodsManagerGoodsItem[];
  total_pages?: number;
}

function apiBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}

function goodsUrl(baseUrl: string, page: number, limit: number): string {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    sort_by: '最近提交时间',
    sort_desc: 'true',
  });
  return `${apiBaseUrl(baseUrl)}/goods?${params.toString()}`;
}

function parseSubmittedAt(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.trim().replace(' ', 'T');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfWindow(referenceDate: string, days: number): Date {
  const reference = new Date(`${referenceDate}T23:59:59.999`);
  reference.setDate(reference.getDate() - days);
  return reference;
}

function inWindow(value: unknown, referenceDate: string, days: number): boolean {
  const submittedAt = parseSubmittedAt(value);
  if (!submittedAt) return false;
  const end = new Date(`${referenceDate}T23:59:59.999`);
  const start = startOfWindow(referenceDate, days);
  return submittedAt >= start && submittedAt <= end;
}

function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeNumber(value: unknown): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : 0;
  return Number.isFinite(number) ? number : 0;
}

function normalizeSkuCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function toNewProductPoolItem(item: GoodsManagerGoodsItem, productId: string): GoodsManagerNewProductPoolItem {
  return {
    productId,
    productName: normalizeText(item.商品名称),
    shortTitle: normalizeText(item.短标题),
    submittedAt: normalizeText(item.最近提交时间),
    merchant: normalizeText(item.merchant) || normalizeText(item.商家),
    alipaySyncStatus: normalizeText(item.是否同步支付宝),
    alipayCode: normalizeText(item.支付宝编码),
    stock: normalizeNumber(item.库存),
    skuCount: normalizeSkuCount(item.skus),
    maintenanceStatus: '待维护',
    note: '',
  };
}

function isAlipaySynced(item: GoodsManagerGoodsItem): boolean {
  return normalizeText(item.是否同步支付宝) === '已同步';
}

function compareProductIds(a: string, b: string): number {
    const aNumber = /^\d+$/.test(a) ? Number(a) : null;
    const bNumber = /^\d+$/.test(b) ? Number(b) : null;
    if (aNumber !== null && bNumber !== null) return aNumber - bNumber;
    if (aNumber !== null) return -1;
    if (bNumber !== null) return 1;
    return a.localeCompare(b);
}

function submittedTime(item: GoodsManagerNewProductPoolItem): number {
  return parseSubmittedAt(item.submittedAt)?.getTime() ?? Number.NEGATIVE_INFINITY;
}

function sortProductsBySubmittedAt(items: GoodsManagerNewProductPoolItem[]): GoodsManagerNewProductPoolItem[] {
  return [...items].sort((a, b) => submittedTime(b) - submittedTime(a) || compareProductIds(a.productId, b.productId));
}

async function fetchGoodsPage(fetchImpl: typeof fetch, url: string): Promise<GoodsManagerGoodsResponse> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Goods manager request failed: ${response.status}`);
  return (await response.json()) as GoodsManagerGoodsResponse;
}

export async function fetchRecentGoodsManagerProductIds(options: FetchRecentGoodsManagerProductIdsOptions): Promise<string[]> {
  const products = await fetchRecentGoodsManagerProducts(options);
  return products.map((item) => item.productId);
}

export async function fetchRecentGoodsManagerProducts(options: FetchRecentGoodsManagerProductsOptions): Promise<GoodsManagerNewProductPoolItem[]> {
  const days = options.days ?? 7;
  const pageSize = options.pageSize ?? 500;
  const fetchImpl = options.fetchImpl ?? fetch;
  const products = new Map<string, GoodsManagerNewProductPoolItem>();
  let totalPages = 1;

  for (let page = 1; page <= totalPages; page += 1) {
    const result = await fetchGoodsPage(fetchImpl, goodsUrl(options.baseUrl, page, pageSize));
    totalPages = Math.max(1, Number(result.total_pages) || 1);
    for (const item of result.data ?? []) {
      const id = typeof item.ID === 'string' || typeof item.ID === 'number' ? String(item.ID).trim() : '';
      if (id && !products.has(id) && inWindow(item.最近提交时间, options.referenceDate, days) && (!options.requireAlipaySynced || isAlipaySynced(item))) {
        products.set(id, toNewProductPoolItem(item, id));
      }
    }
  }

  return sortProductsBySubmittedAt([...products.values()]);
}
