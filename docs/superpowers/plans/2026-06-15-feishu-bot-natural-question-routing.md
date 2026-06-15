# Feishu Bot Natural Question Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Feishu bot answer common natural-language read-only questions while keeping report-generation and group-push actions strictly command-gated.

**Architecture:** Keep deterministic routing. `parseBotIntent()` remains responsible for strict bot-level commands and direct product lookups; unresolved text falls through to `parseAgentDataIntent()`, which maps broader read-only questions to Agent intents. `handleBotIntent()` becomes the single tool dispatcher for all Agent intents and formats safe read-only responses from the latest report context.

**Tech Stack:** TypeScript, Vitest, Feishu bot SDK/HTTP dispatcher, existing public traffic report context helpers.

---

## File Structure

- Modify `src/feishuBot/intent.ts`: widen only safe read-only bot-level parsing; keep run/resend/push exact enough to avoid side effects.
- Modify `src/agentData/intent.ts`: add natural-language phrase coverage for overview, product, new-link pool, task, problem-product, removed-link, and order questions.
- Modify `src/feishuBot/tools.ts`: handle all Agent intents currently defined in `src/agentData/types.ts`, not only tasks/problem/removed.
- Modify `src/agentData/publicTrafficQueries.ts` only if needed for formatting inputs; prefer no changes unless tests prove a missing helper.
- Modify tests:
  - `tests/feishuBotIntent.test.ts`
  - `tests/agentDataIntent.test.ts`
  - `tests/feishuBotTools.test.ts`

---

### Task 1: Widen Safe Intent Parsing

**Files:**
- Modify: `src/feishuBot/intent.ts`
- Modify: `src/agentData/intent.ts`
- Test: `tests/feishuBotIntent.test.ts`
- Test: `tests/agentDataIntent.test.ts`

- [ ] **Step 1: Add failing tests for safe natural bot intents**

Add this test to `tests/feishuBotIntent.test.ts` after the latest summary test:

```ts
  it('parses natural read-only summary questions without triggering actions', () => {
    expect(parseBotIntent('今天咋样')).toEqual({ type: 'latest_summary' });
    expect(parseBotIntent('现在公域怎么样')).toEqual({ type: 'latest_summary' });
    expect(parseBotIntent('日报概况')).toEqual({ type: 'latest_summary' });
    expect(parseBotIntent('能不能看下今天数据')).toEqual({ type: 'latest_summary' });
  });
```

Add this test to `tests/feishuBotIntent.test.ts` after the product query test:

```ts
  it('parses natural product lookup questions', () => {
    expect(parseBotIntent('查一下721')).toEqual({ type: 'query_product', keyword: '721' });
    expect(parseBotIntent('721怎么样')).toEqual({ type: 'query_product', keyword: '721' });
    expect(parseBotIntent('帮我看下 Pocket 3')).toEqual({ type: 'query_product', keyword: 'Pocket 3' });
    expect(parseBotIntent('这个商品 721 数据如何')).toEqual({ type: 'query_product', keyword: '721' });
  });
```

Add this safety test to `tests/feishuBotIntent.test.ts` before the fallback test:

```ts
  it('does not trigger side-effect actions from vague natural language', () => {
    expect(parseBotIntent('帮我看看日报')).toEqual({ type: 'latest_summary' });
    expect(parseBotIntent('要不要发群里看看')).toEqual({ type: 'unknown', text: '要不要发群里看看' });
    expect(parseBotIntent('可以重新看下日报吗')).toEqual({ type: 'latest_summary' });
  });
```

Add this test to `tests/agentDataIntent.test.ts` after the existing test:

```ts
  it('maps natural read-only questions to agent data intents', () => {
    expect(parseAgentDataIntent('新链接池怎么样')).toEqual({ type: 'new_product_pool' });
    expect(parseAgentDataIntent('新链有哪些')).toEqual({ type: 'new_product_pool' });
    expect(parseAgentDataIntent('冷启动链接情况')).toEqual({ type: 'new_product_pool' });
    expect(parseAgentDataIntent('有哪些要处理')).toEqual({ type: 'tasks' });
    expect(parseAgentDataIntent('今天优先处理什么')).toEqual({ type: 'tasks' });
    expect(parseAgentDataIntent('哪些链接不健康')).toEqual({ type: 'tasks' });
    expect(parseAgentDataIntent('成交少的有哪些')).toEqual({ type: 'problem_products', problemType: 'weak_conversion' });
    expect(parseAgentDataIntent('曝光低的链接')).toEqual({ type: 'problem_products', problemType: 'low_exposure' });
    expect(parseAgentDataIntent('哪些可以继续放量')).toEqual({ type: 'problem_products', problemType: 'high_potential' });
    expect(parseAgentDataIntent('最近下架了哪些')).toEqual({ type: 'removed_links' });
    expect(parseAgentDataIntent('履约情况')).toEqual({ type: 'order_summary' });
  });
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
npm test -- tests/feishuBotIntent.test.ts tests/agentDataIntent.test.ts
```

Expected: failures showing the new natural phrases are currently parsed as `unknown` or too-strict intents.

- [ ] **Step 3: Implement minimal parser changes**

Replace `parseBotIntent()` in `src/feishuBot/intent.ts` with:

```ts
export function parseBotIntent(input: string): BotIntent {
  const text = normalize(input);
  if (!text) return { type: 'help' };
  if (/^(帮助|help|\/help)$/i.test(text)) return { type: 'help' };
  if (/^(跑|生成|执行).*(公域)?日报/.test(text)) return { type: 'run_public_traffic_report', sendTo: sendTo(text) };
  if (/^推送(日报|公域日报)到群$/.test(text)) return { type: 'push_latest_report_to_group' };
  if (/^重发.*(公域)?日报/.test(text)) return { type: 'resend_latest_report', sendTo: sendTo(text) };
  if (/(今日|今天|最新|现在|日报|公域).*(概况|数据|怎么样|如何|咋样)|日报概况/.test(text)) return { type: 'latest_summary' };

  const query = /^(查询|商品|查一下|查|帮我看下|看下)\s*(.+)$/.exec(text);
  if (query) return { type: 'query_product', keyword: query[2].trim() };
  const productStatus = /^(?:这个商品\s*)?([A-Za-z0-9\-\s\u4e00-\u9fa5]+?)(?:怎么样|数据如何|情况如何)$/.exec(text);
  if (productStatus) return { type: 'query_product', keyword: productStatus[1].replace(/^商品\s*/, '').trim() };

  return { type: 'unknown', text };
}
```

Replace `parseAgentDataIntent()` in `src/agentData/intent.ts` with:

```ts
export function parseAgentDataIntent(input: string): AgentIntent {
  const text = input.replace(/\s+/g, ' ').trim();
  if (/(今天|今日|最新|现在|公域).*(怎么样|咋样|如何|概况|数据)/.test(text)) return { type: 'overview' };
  const product = /^(查询|商品|查一下|查|帮我看下|看下)\s*(.+)$/.exec(text);
  if (product) return { type: 'product', keyword: product[2].trim() };
  const productStatus = /^(?:这个商品\s*)?([A-Za-z0-9\-\s\u4e00-\u9fa5]+?)(?:怎么样|数据如何|情况如何)$/.exec(text);
  if (productStatus) return { type: 'product', keyword: productStatus[1].replace(/^商品\s*/, '').trim() };
  if (/(新链接池|新链接|新链|新品池|新品维护|冷启动)/.test(text)) return { type: 'new_product_pool' };
  if (/(要处理|任务|优先|不健康)/.test(text)) return { type: 'tasks' };
  if (/(下架|移除|消失).*(链接|商品)?/.test(text)) return { type: 'removed_links' };
  if (/转化差|提转化|成交少/.test(text)) return { type: 'problem_products', problemType: 'weak_conversion' };
  if (/曝光低|补曝光/.test(text)) return { type: 'problem_products', problemType: 'low_exposure' };
  if (/高潜力|继续放量|放量/.test(text)) return { type: 'problem_products', problemType: 'high_potential' };
  if (/订单|发货|履约|归还|关单/.test(text)) return { type: 'order_summary' };
  return { type: 'unknown', text };
}
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```powershell
npm test -- tests/feishuBotIntent.test.ts tests/agentDataIntent.test.ts
```

Expected: all tests in those two files pass.

- [ ] **Step 5: Commit parser changes**

Run:

```powershell
git add src/feishuBot/intent.ts src/agentData/intent.ts tests/feishuBotIntent.test.ts tests/agentDataIntent.test.ts
git commit -m "功能：放宽飞书机器人只读问句解析"
```

---

### Task 2: Route All Agent Data Intents in Tools

**Files:**
- Modify: `src/feishuBot/tools.ts`
- Test: `tests/feishuBotTools.test.ts`

- [ ] **Step 1: Add failing tests for missing Agent intent routing**

In `tests/feishuBotTools.test.ts`, add a test that creates a report context with `newProductPoolItems`, `orderAnalysis`, and a product row. Use the existing helper style in the file. Add these assertions in a new `it` block:

```ts
  await expect(handleBotIntent({ type: 'unknown', text: '今天咋样' }, dir)).resolves.toMatchObject({ text: expect.stringContaining('公域日报') });
  await expect(handleBotIntent({ type: 'unknown', text: '新链接池怎么样' }, dir)).resolves.toMatchObject({ text: expect.stringContaining('701') });
  await expect(handleBotIntent({ type: 'unknown', text: '查一下701' }, dir)).resolves.toMatchObject({ text: expect.stringContaining('701') });
  await expect(handleBotIntent({ type: 'unknown', text: '订单情况' }, dir)).resolves.toMatchObject({ text: expect.stringContaining('订单') });
```

The context JSON must include at least:

```ts
newProductPoolItems: [{ productId: '701', productName: '大疆 Pocket 3', shortTitle: '', submittedAt: '2026-06-12 09:00:00', merchant: '', alipaySyncStatus: '已同步', alipayCode: '', stock: 0, skuCount: 0, maintenanceStatus: '待维护', note: '' }],
newProductPoolIds: ['701'],
rows: [{ productName: '大疆 Pocket 3', platformProductId: 'p701', displayProductId: '端内ID 701', custodyDays: 1, periods: { '1d': metric, '7d': metric, '30d': metric } }],
orderAnalysis: { runDate: '2026-06-13', pages: { overview: { label: '订单概览', dataDate: '2026-06-12', indicators: [{ label: '发货订单', value: '12' }] } } },
```

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
npm test -- tests/feishuBotTools.test.ts
```

Expected: failures for `new_product_pool`, `product`, and `order_summary` currently returning the generic unsupported text.

- [ ] **Step 3: Add minimal formatters in `src/feishuBot/tools.ts`**

Add imports:

```ts
import { getLatestOverview, getNewProductPool, getProductPerformance } from '../agentData/publicTrafficQueries.js';
```

Add helper functions above `handleBotIntent()`:

```ts
function formatNewProductPoolLines(items: Array<{ productId: string; productName: string; maintenanceStatus: string }>): string {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item.productId}：${item.productName || '未命名'}。状态：${item.maintenanceStatus}`).join('\n') : '暂无新链接池商品。';
}

function formatOverviewLines(contextDate: string, metrics: ReturnType<typeof getLatestOverview>['metrics']): string {
  const one = metrics.find((metric) => metric.period === '1d');
  if (!one) return `公域日报 ${contextDate}\n暂无 1 日概况。`;
  return `公域日报 ${contextDate}\n曝光 ${one.exposure}，访问 ${one.publicVisits}，发货 ${one.shippedOrders}，金额 ¥${one.amount.toFixed(2)}`;
}

function formatProductAnswer(answer: ReturnType<typeof getProductPerformance>): string {
  if (!answer) return '暂无匹配商品。';
  const one = answer.periods.find((metric) => metric.period === '1d');
  const seven = answer.periods.find((metric) => metric.period === '7d');
  return [
    `${answer.productId} ${answer.productName}`,
    one ? `1日：曝光 ${one.exposure}，访问 ${one.publicVisits}，发货 ${one.shippedOrders}` : '',
    seven ? `7日：曝光 ${seven.exposure}，访问 ${seven.publicVisits}，发货 ${seven.shippedOrders}` : '',
  ].filter(Boolean).join('\n');
}

function formatOrderSummary(context: { orderAnalysis?: { pages?: Record<string, { label: string; indicators: Array<{ label: string; value: string }> }> } }): string {
  const overview = context.orderAnalysis?.pages?.overview;
  if (!overview?.indicators?.length) return '暂无订单概况。';
  return ['订单情况', ...overview.indicators.slice(0, 8).map((item) => `${item.label}：${item.value}`)].join('\n');
}
```

- [ ] **Step 4: Route all Agent intents in `handleBotIntent()`**

Inside `if (intent.type === 'unknown')`, replace the block with:

```ts
  if (intent.type === 'unknown') {
    const dataIntent = parseAgentDataIntent(intent.text);
    const latest = await findLatestReportContext(outputDir);
    if (!latest) return { text: '还没有找到公域日报上下文。' };

    if (dataIntent.type === 'overview') {
      const overview = getLatestOverview(latest.context);
      return { text: formatOverviewLines(overview.date, overview.metrics) };
    }
    if (dataIntent.type === 'product') {
      return { text: formatProductAnswer(getProductPerformance(latest.context, dataIntent.keyword)) };
    }
    if (dataIntent.type === 'new_product_pool') {
      return { text: formatNewProductPoolLines(getNewProductPool(latest.context)) };
    }
    if (dataIntent.type === 'tasks') {
      return { text: formatTaskLines(buildAgentTaskPool(latest.context)) };
    }
    if (dataIntent.type === 'problem_products') {
      return { text: formatProblemLines(getProblemProducts(latest.context, dataIntent.problemType)) };
    }
    if (dataIntent.type === 'removed_links') {
      return { text: formatRemovedLinkLines(getRemovedLinks(latest.context)) };
    }
    if (dataIntent.type === 'order_summary') {
      return { text: formatOrderSummary(latest.context) };
    }
  }
```

- [ ] **Step 5: Run test to verify GREEN**

Run:

```powershell
npm test -- tests/feishuBotTools.test.ts
```

Expected: all `feishuBotTools` tests pass.

- [ ] **Step 6: Commit tool routing changes**

Run:

```powershell
git add src/feishuBot/tools.ts tests/feishuBotTools.test.ts
git commit -m "功能：补齐飞书机器人只读工具路由"
```

---

### Task 3: Improve Unknown Response Guidance

**Files:**
- Modify: `src/feishuBot/tools.ts`
- Test: `tests/feishuBotTools.test.ts`

- [ ] **Step 1: Add failing test for unknown guidance**

Add this assertion to an existing unknown-intent test or a new test in `tests/feishuBotTools.test.ts`:

```ts
  await expect(handleBotIntent({ type: 'unknown', text: '随便聊聊' }, dir)).resolves.toEqual({
    text: '我现在可以查：今日概况、商品、新链接池、待处理任务、转化差、曝光低、高潜力、下架链接、订单情况。你可以问“新链接池怎么样”或“查一下721”。',
  });
```

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
npm test -- tests/feishuBotTools.test.ts
```

Expected: failure because current fallback is `暂时只支持...`.

- [ ] **Step 3: Implement guidance constant**

Add near the top of `src/feishuBot/tools.ts`:

```ts
const UNKNOWN_GUIDANCE = '我现在可以查：今日概况、商品、新链接池、待处理任务、转化差、曝光低、高潜力、下架链接、订单情况。你可以问“新链接池怎么样”或“查一下721”。';
```

Replace the final return with:

```ts
  return { text: UNKNOWN_GUIDANCE };
```

- [ ] **Step 4: Run test to verify GREEN**

Run:

```powershell
npm test -- tests/feishuBotTools.test.ts
```

Expected: all `feishuBotTools` tests pass.

- [ ] **Step 5: Commit guidance change**

Run:

```powershell
git add src/feishuBot/tools.ts tests/feishuBotTools.test.ts
git commit -m "优化：飞书机器人未知问句提示"
```

---

### Task 4: Final Verification

**Files:**
- No code changes expected.

- [ ] **Step 1: Run focused bot and agent-data tests**

Run:

```powershell
npm test -- tests/feishuBotIntent.test.ts tests/agentDataIntent.test.ts tests/feishuBotTools.test.ts tests/feishuBotDispatcher.test.ts tests/feishuBotSdkClient.test.ts tests/feishuBotServer.test.ts
```

Expected: all selected test files pass.

- [ ] **Step 2: Run TypeScript build**

Run:

```powershell
npm run build
```

Expected: `tsc -p tsconfig.json` exits with code 0.

- [ ] **Step 3: Inspect diff and status**

Run:

```powershell
git status -sb
git diff --stat
```

Expected: only intended files are modified or all changes are committed. Do not revert unrelated existing worktree changes.

- [ ] **Step 4: Optional live restart**

If the user asks to deploy the updated bot, restart the SDK bot with the existing safe process. Do not run browser/report commands.

Use the already configured `FEISHU_BOT_MENTION_NAME=公域数据日报` and verify startup by checking `output/feishu-bot-sdk.out.log` for:

```text
Feishu SDK bot long connection started.
ws client ready
```

---

## Self-Review Notes

- Spec coverage: The plan covers read-only natural routing, Agent intent tool wiring, unknown guidance, and side-effect safety tests.
- Placeholder scan: No TBD/TODO placeholders remain; each task has concrete file paths, snippets, commands, and expected results.
- Type consistency: The plan uses existing `BotIntent`, `AgentIntent`, `getLatestOverview`, `getProductPerformance`, `getNewProductPool`, and `PublicTrafficDataReportContext` shapes.
