# Goods Manager New Product Pool V2 Implementation Plan

> **Archive status:** Implementation and delivery verification for this plan are complete. The unchecked task boxes below are preserved as the original execution plan and are not current task status.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade MT-agent's goods-manager new product pool output from an ID list to an operations-ready product maintenance table.

**Architecture:** Keep goods-manager unchanged and continue reading `GET /api/goods?page=1&limit=500&sort_by=最近提交时间&sort_desc=true`. Add a typed MT-agent new product pool item model, have the client preserve product fields after local 7-day filtering, and make workbook/Feishu output consume the enriched item list while retaining `newProductPoolIds` for compatibility.

**Tech Stack:** TypeScript, Vitest, `xlsx-js-style`, existing MT-agent public traffic report pipeline.

---

## File Structure

- Modify: `src/publicTraffic/goodsManagerNewProducts.ts`
  - Owns goods-manager `/api/goods` URL construction, pagination, local submitted-time filtering, deduplication, and product field normalization.
  - Add `GoodsManagerNewProductPoolItem` export and `fetchRecentGoodsManagerProducts()`.
  - Keep `fetchRecentGoodsManagerProductIds()` as a compatibility wrapper over the enriched function.
- Modify: `src/publicTraffic/types.ts`
  - Add `newProductPoolItems?: GoodsManagerNewProductPoolItem[]` to `PublicTrafficDataReportContext`.
- Modify: `src/publicTraffic/buildPublicTrafficWorkbook.ts`
  - Render `新品池维护` from `newProductPoolItems` when present.
  - Fall back to v1 `newProductPoolIds` behavior when only IDs exist.
- Modify: `src/publicTraffic/buildPublicTrafficFeishu.ts`
  - Count `newProductPoolItems` first, then `newProductPoolIds`.
  - Render text preview as `商品ID 商品名称：待维护`, limited to 10 items.
- Modify: `src/publicTraffic/buildPublicTrafficCard.ts`
  - Count `newProductPoolItems` first, then `newProductPoolIds`, then existing `newProductObservation` fallback.
  - Render collapsible preview as `商品ID 商品名称：待维护`, limited to 10 items, with short names for card width.
- Modify: `src/cli/publicTrafficReport.ts`
  - Import and call `fetchRecentGoodsManagerProducts()`.
  - Write both `newProductPoolItems` and `newProductPoolIds` into report context when products exist.
- Modify: `tests/goodsManagerNewProducts.test.ts`
  - Add enriched client tests for field preservation/defaults, pagination, window filtering, deduplication, and bad-date exclusion.
- Modify: `tests/publicTrafficReport.test.ts`
  - Add workbook header/value tests and Feishu text/card preview tests for enriched pool items.
- Modify: `tests/publicTrafficReportCliBehavior.test.ts`
  - Update mock/export names and add a CLI test that enriched goods-manager products are written to report context.

## Task 1: Goods Manager Enriched Client

**Files:**
- Modify: `tests/goodsManagerNewProducts.test.ts`
- Modify: `src/publicTraffic/goodsManagerNewProducts.ts`

- [ ] **Step 1: Write the failing enriched client test**

Add `fetchRecentGoodsManagerProducts` to the import and append this test inside `describe('fetchRecentGoodsManagerProductIds', () => { ... })`:

```ts
import { fetchRecentGoodsManagerProductIds, fetchRecentGoodsManagerProducts } from '../src/publicTraffic/goodsManagerNewProducts.js';

it('returns enriched unique products submitted within the date window', async () => {
  const requestedUrls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    requestedUrls.push(url);
    const page = new URL(url).searchParams.get('page');
    const body = page === '1'
      ? {
          data: [
            {
              ID: 701,
              商品名称: '新品 Alpha',
              短标题: 'Alpha 短标题',
              最近提交时间: '2026-06-12 09:00:00',
              merchant: '主商家',
              商家: '备用商家',
              是否同步支付宝: '已同步',
              支付宝编码: 'ALI-701',
              库存: 8,
              skus: [{ id: 'sku-1' }, { id: 'sku-2' }],
            },
            {
              ID: 'old',
              商品名称: '旧商品',
              最近提交时间: '2026-06-01 09:00:00',
              库存: 99,
              skus: [{ id: 'old-sku' }],
            },
          ],
          total_pages: 2,
        }
      : {
          data: [
            {
              ID: '702',
              商品名称: '新品 Beta',
              短标题: null,
              最近提交时间: '2026-06-06 23:59:59',
              商家: '备用商家 B',
              是否同步支付宝: false,
              支付宝编码: null,
              库存: '12',
              skus: [{ id: 'sku-3' }],
            },
            {
              ID: '701',
              商品名称: '重复 Alpha',
              最近提交时间: '2026-06-12 10:00:00',
              skus: [{ id: 'duplicate' }],
            },
            { ID: 'bad-date', 商品名称: '坏日期', 最近提交时间: 'not a date' },
          ],
          total_pages: 2,
        };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  await expect(fetchRecentGoodsManagerProducts({ baseUrl: 'http://goods.local:3010/api/', days: 7, referenceDate: '2026-06-12', fetchImpl })).resolves.toEqual([
    {
      productId: '701',
      productName: '新品 Alpha',
      shortTitle: 'Alpha 短标题',
      submittedAt: '2026-06-12 09:00:00',
      merchant: '主商家',
      alipaySyncStatus: '已同步',
      alipayCode: 'ALI-701',
      stock: 8,
      skuCount: 2,
      maintenanceStatus: '待维护',
      note: '',
    },
    {
      productId: '702',
      productName: '新品 Beta',
      shortTitle: '',
      submittedAt: '2026-06-06 23:59:59',
      merchant: '备用商家 B',
      alipaySyncStatus: 'false',
      alipayCode: '',
      stock: 12,
      skuCount: 1,
      maintenanceStatus: '待维护',
      note: '',
    },
  ]);
  expect(requestedUrls[0]).toBe('http://goods.local:3010/api/goods?page=1&limit=500&sort_by=%E6%9C%80%E8%BF%91%E6%8F%90%E4%BA%A4%E6%97%B6%E9%97%B4&sort_desc=true');
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- tests/goodsManagerNewProducts.test.ts`

Expected: FAIL because `fetchRecentGoodsManagerProducts` is not exported.

- [ ] **Step 3: Implement the enriched client**

Replace `src/publicTraffic/goodsManagerNewProducts.ts` with this shape, preserving the existing URL and date-window behavior:

```ts
export interface FetchRecentGoodsManagerProductIdsOptions {
  baseUrl: string;
  days?: number;
  referenceDate: string;
  fetchImpl?: typeof fetch;
  pageSize?: number;
}

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

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function skuCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
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

function compareProductIds(a: string, b: string): number {
  const aNumber = /^\d+$/.test(a) ? Number(a) : null;
  const bNumber = /^\d+$/.test(b) ? Number(b) : null;
  if (aNumber !== null && bNumber !== null) return aNumber - bNumber;
  if (aNumber !== null) return -1;
  if (bNumber !== null) return 1;
  return a.localeCompare(b);
}

function toNewProductPoolItem(item: GoodsManagerGoodsItem): GoodsManagerNewProductPoolItem | null {
  const productId = text(item.ID);
  if (!productId) return null;
  return {
    productId,
    productName: text(item.商品名称),
    shortTitle: text(item.短标题),
    submittedAt: text(item.最近提交时间),
    merchant: text(item.merchant) || text(item.商家),
    alipaySyncStatus: text(item.是否同步支付宝),
    alipayCode: text(item.支付宝编码),
    stock: numberValue(item.库存),
    skuCount: skuCount(item.skus),
    maintenanceStatus: '待维护',
    note: '',
  };
}

async function fetchGoodsPage(fetchImpl: typeof fetch, url: string): Promise<GoodsManagerGoodsResponse> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Goods manager request failed: ${response.status}`);
  return (await response.json()) as GoodsManagerGoodsResponse;
}

export async function fetchRecentGoodsManagerProducts(options: FetchRecentGoodsManagerProductIdsOptions): Promise<GoodsManagerNewProductPoolItem[]> {
  const days = options.days ?? 7;
  const pageSize = options.pageSize ?? 500;
  const fetchImpl = options.fetchImpl ?? fetch;
  const products = new Map<string, GoodsManagerNewProductPoolItem>();
  let totalPages = 1;

  for (let page = 1; page <= totalPages; page += 1) {
    const result = await fetchGoodsPage(fetchImpl, goodsUrl(options.baseUrl, page, pageSize));
    totalPages = Math.max(1, Number(result.total_pages) || 1);
    for (const item of result.data ?? []) {
      const product = toNewProductPoolItem(item);
      if (product && !products.has(product.productId) && inWindow(item.最近提交时间, options.referenceDate, days)) {
        products.set(product.productId, product);
      }
    }
  }

  return [...products.values()].sort((a, b) => compareProductIds(a.productId, b.productId));
}

export async function fetchRecentGoodsManagerProductIds(options: FetchRecentGoodsManagerProductIdsOptions): Promise<string[]> {
  const products = await fetchRecentGoodsManagerProducts(options);
  return products.map((item) => item.productId);
}
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm test -- tests/goodsManagerNewProducts.test.ts`

Expected: PASS for both existing ID wrapper behavior and new enriched behavior.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add src/publicTraffic/goodsManagerNewProducts.ts tests/goodsManagerNewProducts.test.ts
git commit -m "功能：读取goods-manager新品明细"
```

Expected: commit succeeds.

## Task 2: Workbook Enriched Maintenance Sheet

**Files:**
- Modify: `tests/publicTrafficReport.test.ts`
- Modify: `src/publicTraffic/types.ts`
- Modify: `src/publicTraffic/buildPublicTrafficWorkbook.ts`

- [ ] **Step 1: Write the failing workbook test**

Add this test near the existing `writes goods-manager new product pool IDs into workbook and Feishu text` test:

```ts
it('writes enriched goods-manager new product pool items into workbook maintenance sheet', () => {
  const withPool: PublicTrafficDataReportContext = {
    ...context,
    newProductPoolItems: [
      {
        productId: '701',
        productName: '新品 Alpha',
        shortTitle: 'Alpha 短标题',
        submittedAt: '2026-06-12 09:00:00',
        merchant: '主商家',
        alipaySyncStatus: '已同步',
        alipayCode: 'ALI-701',
        stock: 8,
        skuCount: 2,
        maintenanceStatus: '待维护',
        note: '',
      },
    ],
  };

  const workbook = XLSX.read(writePublicTrafficWorkbookBuffer(withPool), { type: 'buffer' });
  expect(workbook.SheetNames).toContain('新品池维护');
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['新品池维护']);
  expect(Object.keys(rows[0])).toEqual(['商品ID', '商品名称', '短标题', '最近提交时间', '商家', '同步状态', '支付宝编码', '库存', 'SKU数', '维护状态', '备注']);
  expect(rows).toEqual([
    {
      商品ID: '701',
      商品名称: '新品 Alpha',
      短标题: 'Alpha 短标题',
      最近提交时间: '2026-06-12 09:00:00',
      商家: '主商家',
      同步状态: '已同步',
      支付宝编码: 'ALI-701',
      库存: 8,
      SKU数: 2,
      维护状态: '待维护',
      备注: '',
    },
  ]);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- tests/publicTrafficReport.test.ts -t "enriched goods-manager"`

Expected: FAIL because `PublicTrafficDataReportContext` lacks `newProductPoolItems` and workbook still renders ID-only rows.

- [ ] **Step 3: Add the report context type field**

In `src/publicTraffic/types.ts`, add this import and field:

```ts
import type { GoodsManagerNewProductPoolItem } from './goodsManagerNewProducts.js';
```

```ts
newProductPoolItems?: GoodsManagerNewProductPoolItem[];
newProductPoolIds?: string[];
```

- [ ] **Step 4: Implement workbook enriched sheet rendering**

In `src/publicTraffic/buildPublicTrafficWorkbook.ts`, import the item type and replace `newProductPoolSheet(ids: string[])` with item-aware helpers:

```ts
import type { GoodsManagerNewProductPoolItem } from './goodsManagerNewProducts.js';
```

```ts
function newProductPoolSheetFromItems(items: GoodsManagerNewProductPoolItem[]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet([
    ['商品ID', '商品名称', '短标题', '最近提交时间', '商家', '同步状态', '支付宝编码', '库存', 'SKU数', '维护状态', '备注'],
    ...items.map((item) => [
      item.productId,
      item.productName,
      item.shortTitle,
      item.submittedAt,
      item.merchant,
      item.alipaySyncStatus,
      item.alipayCode,
      item.stock,
      item.skuCount,
      item.maintenanceStatus,
      item.note,
    ]),
  ]);
}

function newProductPoolSheetFromIds(ids: string[]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet([
    ['商品ID', '维护状态', '备注'],
    ...ids.map((id) => [id, '待维护', '']),
  ]);
}
```

Then replace the append condition:

```ts
if (context.newProductPoolItems?.length) {
  XLSX.utils.book_append_sheet(workbook, newProductPoolSheetFromItems(context.newProductPoolItems), '新品池维护');
} else if (context.newProductPoolIds?.length) {
  XLSX.utils.book_append_sheet(workbook, newProductPoolSheetFromIds(context.newProductPoolIds), '新品池维护');
}
```

- [ ] **Step 5: Run the focused workbook tests**

Run: `npm test -- tests/publicTrafficReport.test.ts -t "new product pool|新品池维护|enriched goods-manager"`

Expected: PASS for enriched sheet and existing ID-only compatibility test.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add src/publicTraffic/types.ts src/publicTraffic/buildPublicTrafficWorkbook.ts tests/publicTrafficReport.test.ts
git commit -m "功能：输出新品池维护明细表"
```

Expected: commit succeeds.

## Task 3: Feishu Text and Card Enriched Preview

**Files:**
- Modify: `tests/publicTrafficReport.test.ts`
- Modify: `src/publicTraffic/buildPublicTrafficFeishu.ts`
- Modify: `src/publicTraffic/buildPublicTrafficCard.ts`

- [ ] **Step 1: Write the failing Feishu text/card test**

Add this test near the Feishu output tests in `tests/publicTrafficReport.test.ts`:

```ts
it('renders enriched goods-manager new product pool summaries in Feishu text and card', () => {
  const longName = '超长商品名称用于验证卡片会做简短展示避免过宽';
  const withPool: PublicTrafficDataReportContext = {
    ...context,
    newProductPoolItems: Array.from({ length: 11 }, (_, index) => ({
      productId: String(701 + index),
      productName: index === 0 ? '新品 Alpha' : index === 10 ? '第十一个不展示' : longName,
      shortTitle: '',
      submittedAt: '2026-06-12 09:00:00',
      merchant: '',
      alipaySyncStatus: '',
      alipayCode: '',
      stock: 0,
      skuCount: 0,
      maintenanceStatus: '待维护',
      note: '',
    })),
  };

  const text = buildPublicTrafficFeishuText(withPool, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
  expect(text).toContain('新品池维护 11');
  expect(text).toContain('1. 商品ID 701 新品 Alpha：待维护');
  expect(text).toContain('10. 商品ID 710 超长商品名称用于验证卡片会做简短展示避免过宽：待维护');
  expect(text).not.toContain('第十一个不展示');

  const cardJson = JSON.stringify(buildPublicTrafficCard(withPool, { markdownPath: 'report.md', workbookPath: 'report.xlsx' }));
  expect(cardJson).toContain('新品池维护 11');
  expect(cardJson).toContain('新品维护池（11）');
  expect(cardJson).toContain('商品ID 701 新品 Alpha：待维护');
  expect(cardJson).toContain('商品ID 710 超长商品名称用于验证卡片会做...：待维护');
  expect(cardJson).not.toContain('第十一个不展示');
});
```

- [ ] **Step 2: Run the focused Feishu test to verify it fails**

Run: `npm test -- tests/publicTrafficReport.test.ts -t "enriched goods-manager new product pool summaries"`

Expected: FAIL because Feishu output still reads only `newProductPoolIds`.

- [ ] **Step 3: Implement Feishu text enriched preview**

In `src/publicTraffic/buildPublicTrafficFeishu.ts`, add helpers:

```ts
function newProductPoolCount(context: PublicTrafficDataReportContext): number {
  return context.newProductPoolItems?.length ?? context.newProductPoolIds?.length ?? 0;
}

function newProductPoolLines(context: PublicTrafficDataReportContext): string[] {
  if (context.newProductPoolItems?.length) {
    return itemLines(context.newProductPoolItems.slice(0, 10), (item) => `商品ID ${item.productId} ${item.productName}：${item.maintenanceStatus}`);
  }
  return itemLines(context.newProductPoolIds?.slice(0, 10) ?? [], (id) => `商品ID ${id}｜待维护`);
}
```

Change the module count row from:

```ts
['新品池维护', context.newProductPoolIds?.length ?? 0],
```

to:

```ts
['新品池维护', newProductPoolCount(context)],
```

Change the section append from:

```ts
appendSection(lines, '新品池维护', itemLines(context.newProductPoolIds ?? [], (id) => `商品ID ${id}｜待维护`));
```

to:

```ts
appendSection(lines, '新品池维护', newProductPoolLines(context));
```

- [ ] **Step 4: Implement Feishu card enriched preview**

In `src/publicTraffic/buildPublicTrafficCard.ts`, add an item short-name helper:

```ts
function shortNewProductName(name: string): string {
  return name.length > 18 ? `${name.slice(0, 18)}...` : name;
}
```

Change `moduleCounts()` from:

```ts
['新品池维护', context.newProductPoolIds?.length ?? 0],
```

to:

```ts
['新品池维护', context.newProductPoolItems?.length ?? context.newProductPoolIds?.length ?? 0],
```

Replace `newProductPoolCount()` and `newProductPoolPanel()` with:

```ts
function newProductPoolCount(context: PublicTrafficDataReportContext): number {
  return context.newProductPoolItems?.length ?? context.newProductPoolIds?.length ?? context.newProductObservation.length;
}

function newProductPoolPanel(context: PublicTrafficDataReportContext): Record<string, unknown> {
  const count = newProductPoolCount(context);
  const preview = context.newProductPoolItems?.length
    ? context.newProductPoolItems.slice(0, 10).map((item) => `- 商品ID ${item.productId} ${shortNewProductName(item.productName)}：${item.maintenanceStatus}`).join('\n')
    : context.newProductPoolIds?.length
      ? context.newProductPoolIds.slice(0, 10).map((id) => `- 商品ID ${id}：待维护`).join('\n')
      : context.newProductObservation.slice(0, 10).map((item) => `- ${item.identifier}：${item.reason}`).join('\n');
  return {
    tag: 'collapsible_panel',
    element_id: 'new_product_pool',
    expanded: false,
    header: { title: { tag: 'plain_text', content: `新品维护池（${count}）` }, vertical_align: 'center', icon: { tag: 'standard_icon', token: 'down-small-ccm_outlined', size: '16px 16px' }, icon_position: 'right', icon_expanded_angle: -180 },
    border: { color: 'grey', corner_radius: '5px' },
    padding: '8px 8px 8px 8px',
    elements: [{ tag: 'markdown', content: [`当前新品维护池 ${count} 个。`, preview].filter(Boolean).join('\n') }],
  };
}
```

- [ ] **Step 5: Run the focused Feishu tests**

Run: `npm test -- tests/publicTrafficReport.test.ts -t "Feishu|enriched goods-manager new product pool summaries|new product pool"`

Expected: PASS, including existing card/text compatibility behavior.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add src/publicTraffic/buildPublicTrafficFeishu.ts src/publicTraffic/buildPublicTrafficCard.ts tests/publicTrafficReport.test.ts
git commit -m "功能：飞书展示新品池明细摘要"
```

Expected: commit succeeds.

## Task 4: CLI Wiring for Enriched Context

**Files:**
- Modify: `tests/publicTrafficReportCliBehavior.test.ts`
- Modify: `src/cli/publicTrafficReport.ts`

- [ ] **Step 1: Update the CLI mock to expose the enriched function**

In `tests/publicTrafficReportCliBehavior.test.ts`, rename the hoisted mock field and module mock:

```ts
fetchRecentGoodsManagerProducts: vi.fn(),
```

```ts
vi.mock('../src/publicTraffic/goodsManagerNewProducts.js', () => ({
  fetchRecentGoodsManagerProducts: mocks.fetchRecentGoodsManagerProducts,
}));
```

Update existing setup and expectations to use `mocks.fetchRecentGoodsManagerProducts`.

- [ ] **Step 2: Write the failing CLI enriched context test**

Replace the existing `loads goods-manager new product pool IDs when GOODS_MANAGER_BASE_URL is configured` test with:

```ts
it('loads goods-manager new product pool items when GOODS_MANAGER_BASE_URL is configured', async () => {
  vi.stubEnv('GOODS_MANAGER_BASE_URL', 'http://192.168.1.22:3010');
  mocks.fetchRecentGoodsManagerProducts.mockResolvedValueOnce([
    {
      productId: '701',
      productName: '新品 Alpha',
      shortTitle: 'Alpha 短标题',
      submittedAt: '2026-06-12 09:00:00',
      merchant: '主商家',
      alipaySyncStatus: '已同步',
      alipayCode: 'ALI-701',
      stock: 8,
      skuCount: 2,
      maintenanceStatus: '待维护',
      note: '',
    },
    {
      productId: '702',
      productName: '新品 Beta',
      shortTitle: '',
      submittedAt: '2026-06-12 10:00:00',
      merchant: '',
      alipaySyncStatus: '',
      alipayCode: '',
      stock: 0,
      skuCount: 0,
      maintenanceStatus: '待维护',
      note: '',
    },
  ]);
  const { runPublicTrafficReportCli } = await import('../src/cli/publicTrafficReport.js');

  await runPublicTrafficReportCli();

  expect(mocks.fetchRecentGoodsManagerProducts).toHaveBeenCalledWith({
    baseUrl: 'http://192.168.1.22:3010',
    days: 7,
    referenceDate: '2026-06-10',
  });
  const todayPaths = buildPublicTrafficPaths(mocks.outputDir, '2026-06-10');
  const context = JSON.parse(await readFile(todayPaths.reportContext, 'utf8')) as PublicTrafficDataReportContext;
  expect(context.newProductPoolIds).toEqual(['701', '702']);
  expect(context.newProductPoolItems).toEqual([
    expect.objectContaining({ productId: '701', productName: '新品 Alpha', stock: 8, skuCount: 2 }),
    expect.objectContaining({ productId: '702', productName: '新品 Beta', stock: 0, skuCount: 0 }),
  ]);
  await expect(readFile(todayPaths.log, 'utf8')).resolves.toContain('goods-manager 新品池: 2 个商品');
});
```

- [ ] **Step 3: Run the focused CLI test to verify it fails**

Run: `npm test -- tests/publicTrafficReportCliBehavior.test.ts -t "goods-manager new product pool items"`

Expected: FAIL because CLI still imports/calls `fetchRecentGoodsManagerProductIds`.

- [ ] **Step 4: Implement CLI enriched wiring**

In `src/cli/publicTrafficReport.ts`, change the import:

```ts
import { fetchRecentGoodsManagerProducts } from '../publicTraffic/goodsManagerNewProducts.js';
import type { ExposureCumulativeProduct, GoodsManagerNewProductPoolItem, PublicTrafficDataReportContext, PublicTrafficDataSummary } from '../publicTraffic/types.js';
```

If `GoodsManagerNewProductPoolItem` is not re-exported from `types.ts`, import it directly instead:

```ts
import type { GoodsManagerNewProductPoolItem } from '../publicTraffic/goodsManagerNewProducts.js';
```

Change `loadGoodsManagerNewProductPool` to return items:

```ts
async function loadGoodsManagerNewProductPool(date: string, log: ReturnType<typeof createRunLog>): Promise<GoodsManagerNewProductPoolItem[]> {
  const baseUrl = process.env.GOODS_MANAGER_BASE_URL?.trim();
  if (!baseUrl) return [];

  try {
    const products = await fetchRecentGoodsManagerProducts({ baseUrl, days: 7, referenceDate: date });
    log.addEvent(`goods-manager 新品池: ${products.length} 个商品`);
    return products;
  } catch (error) {
    log.addEvent(`goods-manager 新品池读取失败: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
```

Change the context assignment:

```ts
const newProductPoolItems = await loadGoodsManagerNewProductPool(runDate, log);
if (newProductPoolItems.length > 0) {
  context.newProductPoolItems = newProductPoolItems;
  context.newProductPoolIds = newProductPoolItems.map((item) => item.productId);
}
```

- [ ] **Step 5: Run the focused CLI tests**

Run: `npm test -- tests/publicTrafficReportCliBehavior.test.ts -t "goods-manager new product pool items|first-run daily delta"`

Expected: PASS for enriched goods-manager context and unchanged sequencing behavior.

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add src/cli/publicTrafficReport.ts tests/publicTrafficReportCliBehavior.test.ts
git commit -m "功能：日报上下文写入新品池明细"
```

Expected: commit succeeds.

## Task 5: Full Verification and Delivery Notes

**Files:**
- Create: `docs/delivery/goods-manager-new-products-v2.md`

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 2: Run the production build**

Run: `npm run build`

Expected: TypeScript build passes.

- [ ] **Step 3: Check git status and recent commits**

Run:

```bash
git status --short
git log --oneline -5
```

Expected: only the delivery note is untracked before Step 4; recent commits include Task 1 through Task 4.

- [ ] **Step 4: Write delivery notes**

Create `docs/delivery/goods-manager-new-products-v2.md` with:

```md
# goods-manager 新品池维护表 v2 交付说明

## 分支

- Worktree: `C:\works\MT-agent\.worktrees\goods-manager-new-products-v2`
- Branch: `feature/goods-manager-new-products-v2`
- Base: v1 commit `987121a`

## 变更

- goods-manager client 继续调用现有 `/api/goods`，本地按运行日期最近 7 天筛选 `最近提交时间`。
- 报告上下文新增 `newProductPoolItems`，保留 `newProductPoolIds`。
- xlsx `新品池维护` sheet 输出商品明细列：商品ID、商品名称、短标题、最近提交时间、商家、同步状态、支付宝编码、库存、SKU数、维护状态、备注。
- 飞书文本和卡片展示新品池数量和前 10 个 `商品ID 商品名称：待维护` 摘要。

## 配置

- `GOODS_MANAGER_BASE_URL=http://192.168.1.22:3010`

## 验证

- `npm test`: PASS
- `npm run build`: PASS

## 非范围

- 未修改 goods-manager。
- 未新增状态文件或历史 xlsx 维护状态继承。
- 未写回 goods-manager。
```

- [ ] **Step 5: Commit delivery notes**

Run:

```bash
git add docs/delivery/goods-manager-new-products-v2.md
git commit -m "文档：新品池维护表v2交付说明"
```

Expected: commit succeeds.

- [ ] **Step 6: Post-commit merge/rebase acceptance without merging master**

Run:

```bash
git status --short
git rebase master
git merge-tree $(git merge-base master HEAD) master HEAD
npm test
npm run build
```

Expected:
- `git status --short` is clean before rebase.
- Rebase reports up to date or completes without conflicts.
- `git merge-tree` output contains no conflict markers.
- `npm test` passes.
- `npm run build` passes.

## Self-Review

- Spec coverage: Task 1 covers existing API use, pagination, local 7-day filtering, deduplication, bad-date exclusion, and product field normalization. Task 2 covers xlsx column order, default maintenance fields, and optional sheet behavior through existing ID-only compatibility. Task 3 covers Feishu count and top-10 summary. Task 4 covers CLI `GOODS_MANAGER_BASE_URL` wiring and report context persistence. Task 5 covers delivery documentation and verification.
- Placeholder scan: The plan contains no `TBD`, `TODO`, `implement later`, or unspecified edge handling. Every code-changing step includes concrete code or exact replacement snippets.
- Type consistency: The enriched item type is `GoodsManagerNewProductPoolItem`; report context field is `newProductPoolItems`; compatibility ID field remains `newProductPoolIds`; client function is `fetchRecentGoodsManagerProducts()` with `fetchRecentGoodsManagerProductIds()` as wrapper.
