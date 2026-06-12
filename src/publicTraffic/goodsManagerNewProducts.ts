export interface FetchRecentGoodsManagerProductIdsOptions {
  baseUrl: string;
  days?: number;
  referenceDate: string;
  fetchImpl?: typeof fetch;
  pageSize?: number;
}

interface GoodsManagerGoodsItem {
  ID?: unknown;
  最近提交时间?: unknown;
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

function sortProductIds(ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const aNumber = /^\d+$/.test(a) ? Number(a) : null;
    const bNumber = /^\d+$/.test(b) ? Number(b) : null;
    if (aNumber !== null && bNumber !== null) return aNumber - bNumber;
    if (aNumber !== null) return -1;
    if (bNumber !== null) return 1;
    return a.localeCompare(b);
  });
}

async function fetchGoodsPage(fetchImpl: typeof fetch, url: string): Promise<GoodsManagerGoodsResponse> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Goods manager request failed: ${response.status}`);
  return (await response.json()) as GoodsManagerGoodsResponse;
}

export async function fetchRecentGoodsManagerProductIds(options: FetchRecentGoodsManagerProductIdsOptions): Promise<string[]> {
  const days = options.days ?? 7;
  const pageSize = options.pageSize ?? 500;
  const fetchImpl = options.fetchImpl ?? fetch;
  const ids = new Set<string>();
  let totalPages = 1;

  for (let page = 1; page <= totalPages; page += 1) {
    const result = await fetchGoodsPage(fetchImpl, goodsUrl(options.baseUrl, page, pageSize));
    totalPages = Math.max(1, Number(result.total_pages) || 1);
    for (const item of result.data ?? []) {
      const id = typeof item.ID === 'string' || typeof item.ID === 'number' ? String(item.ID).trim() : '';
      if (id && inWindow(item.最近提交时间, options.referenceDate, days)) ids.add(id);
    }
  }

  return sortProductIds([...ids]);
}
