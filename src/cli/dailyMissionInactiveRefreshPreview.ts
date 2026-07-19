import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { aggregateWindowProducts, readWindowMetric, type WindowProductAggregate } from '../agentData/windowAggregate.js';
import { buildInactiveRefreshPreviewDeck, buildInactiveRefreshPreviewDeckFromPlan, type CandidateGroup, type CandidateLink, type PreviewPlan } from '../agentRuntime/dailyMissionInactiveRefreshPreviewCard.js';
import { loadClosedOrderRegistryContext } from '../closedOrderFeedback/runtime.js';
import { loadEnv } from '../config/loadEnv.js';
import type { InventoryStatusGroupSnapshot, InventoryStatusSnapshot } from '../inventoryStatus/types.js';
import { createLinkRegistry } from '../linkRegistry/store.js';
import type { LinkRegistryEntry } from '../linkRegistry/types.js';
import { sendFeishuCard, type FeishuDeliveryResult, type FeishuEnv } from '../notify/feishu.js';

function readArg(argv: string[], name: string): string | undefined {
  const flagIndex = argv.indexOf(name);
  if (flagIndex >= 0) return argv[flagIndex + 1];
  return argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function assertDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('date must be YYYY-MM-DD');
}

function assertExplicitPersonalRecipient(env: FeishuEnv): void {
  if (!env.FEISHU_PERSONAL_RECEIVE_ID) throw new Error('missing explicit Feishu personal recipient');
}

function positiveAmount(aggregate: WindowProductAggregate): number | undefined {
  for (const key of ['createdOrderAmount', 'signedOrderAmount', 'reviewedOrderAmount', 'shippedOrderAmount'] as const) {
    const value = readWindowMetric(aggregate, key);
    if (typeof value === 'number' && value > 0) return value;
  }
  return undefined;
}

function groupLimit(activeCount: number): number {
  if (activeCount <= 3) return 1;
  if (activeCount <= 10) return 2;
  return Math.floor(activeCount * 0.2);
}

function groupLimitText(activeCount: number): string {
  if (activeCount <= 3) return '1-3 条最多 1 条';
  if (activeCount <= 10) return '4-10 条最多 2 条';
  return `20%=${groupLimit(activeCount)} 条`;
}

function displayGroupName(group: InventoryStatusGroupSnapshot | undefined, entry: LinkRegistryEntry | undefined, aggregate: WindowProductAggregate): string {
  return group?.groupName ?? entry?.shortName ?? entry?.productName ?? aggregate.productName ?? entry?.sameSkuGroupId ?? '未分组';
}

function classifyAggregate(aggregate: WindowProductAggregate): { decision: string; reason: string; bucket: string; executable: boolean; manual: boolean; excluded: boolean } {
  const amount = readWindowMetric(aggregate, 'amount');
  const exposure = readWindowMetric(aggregate, 'exposure');
  const visits = readWindowMetric(aggregate, 'publicVisits');
  const visitRate = readWindowMetric(aggregate, 'exposureVisitRate');
  const custodyDays = readWindowMetric(aggregate, 'custodyDays');
  const dashboardAmount = positiveAmount(aggregate);
  if (typeof custodyDays === 'number' && custodyDays < 14) return { decision: '排除', reason: `上线 ${custodyDays} 天，未满 14 天，仅观察。`, bucket: '新链保护', executable: false, manual: false, excluded: true };
  if (amount === undefined) return { decision: '人工复核', reason: '曝光侧金额缺失，不能按 0 处理。', bucket: '曝光/金额缺失', executable: false, manual: true, excluded: false };
  if (amount > 0) return { decision: '排除', reason: '14 天曝光侧金额大于 0，不属于失活刷新。', bucket: '有金额排除', executable: false, manual: false, excluded: true };
  if (dashboardAmount !== undefined) return { decision: '人工复核', reason: `曝光侧金额为 0，但访问页订单金额 ${dashboardAmount}，口径冲突。`, bucket: '金额口径冲突', executable: false, manual: true, excluded: false };
  if ((exposure ?? 0) / 14 >= 1000 && (visitRate ?? 0) > 0.05) return { decision: '排除', reason: '高曝光高访问但金额为 0，归为转化异常。', bucket: '转化异常/新链保护', executable: false, manual: false, excluded: true };
  if (visits === undefined && aggregate.missingDashboardDates.length > 0) return { decision: '人工复核', reason: '访问相关数据缺失，需补抓或人工复核。', bucket: '访问补抓失败', executable: false, manual: true, excluded: false };
  return { decision: '可执行', reason: '14 天金额为 0，且未命中转化异常/新链保护。', bucket: '双金额为0且访问弱', executable: true, manual: false, excluded: false };
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(path, 'utf8'))) as T;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function buildRealPreviewPlan(outputDir: string, date: string): Promise<PreviewPlan> {
  const [registryContext, aggregates, sameSkuSnapshot] = await Promise.all([
    loadClosedOrderRegistryContext({ artifactsDir: outputDir, referenceDate: date }),
    aggregateWindowProducts({ outputDir, endDate: date, windowDays: 14 }),
    readJson<InventoryStatusSnapshot>(join(outputDir, date, `同款组经营快照_${date}.json`)),
  ]);
  const registry = createLinkRegistry(registryContext.registry);
  const groupsById = new Map((sameSkuSnapshot?.groups ?? []).map((group) => [group.sameSkuGroupId, group]));
  const entriesByInternalId = new Map(registryContext.registry.map((entry) => [entry.internalProductId, entry]));
  const selectedLinks: CandidateLink[] = [];
  const reasonCounts = new Map<string, number>();
  const groupStats = new Map<string, { entry?: LinkRegistryEntry; group?: InventoryStatusGroupSnapshot; executable: number; manualReview: number; excluded: number; reasons: Set<string> }>();

  for (const aggregate of aggregates) {
    const entry = entriesByInternalId.get(aggregate.internalProductId);
    if (entry && entry.status !== 'active') continue;
    const classification = classifyAggregate(aggregate);
    if (classification.decision === '排除' && classification.bucket === '有金额排除') continue;
    const groupId = entry?.sameSkuGroupId ?? `ungrouped:${aggregate.internalProductId}`;
    const group = entry?.sameSkuGroupId ? groupsById.get(entry.sameSkuGroupId) : undefined;
    const current = groupStats.get(groupId) ?? { entry, group, executable: 0, manualReview: 0, excluded: 0, reasons: new Set<string>() };
    if (classification.executable) current.executable += 1;
    if (classification.manual) current.manualReview += 1;
    if (classification.excluded) current.excluded += 1;
    current.reasons.add(classification.reason);
    groupStats.set(groupId, current);
    reasonCounts.set(classification.bucket, (reasonCounts.get(classification.bucket) ?? 0) + 1);
    selectedLinks.push({
      productId: aggregate.internalProductId,
      groupName: displayGroupName(group, entry, aggregate),
      ageDays: Math.floor(readWindowMetric(aggregate, 'custodyDays') ?? 0),
      avgExposure14d: readWindowMetric(aggregate, 'exposure') !== undefined ? Math.round((readWindowMetric(aggregate, 'exposure') ?? 0) / 14) : undefined,
      visits14d: readWindowMetric(aggregate, 'publicVisits'),
      visitRate: readWindowMetric(aggregate, 'exposureVisitRate'),
      exposureAmount14d: readWindowMetric(aggregate, 'amount'),
      visitOrderAmount14d: positiveAmount(aggregate) ?? 0,
      decision: classification.decision,
      reason: classification.reason,
    });
  }

  const sortedLinks = selectedLinks.sort((left, right) => {
    const score = (value: CandidateLink) => value.decision === '可执行' ? 0 : value.decision === '人工复核' ? 1 : 2;
    return score(left) - score(right) || left.groupName.localeCompare(right.groupName) || Number(left.productId) - Number(right.productId);
  });
  const rawGroups = [...groupStats.entries()].map(([groupId, stat]) => {
    const activeBefore = stat.group?.activeLinkCount ?? registry.listBySameSkuGroup(groupId, { includeRemoved: false }).filter((entry) => entry.status === 'active').length;
    const limit = groupLimit(activeBefore);
    return {
      name: stat.group?.groupName ?? stat.entry?.shortName ?? stat.entry?.sameSkuGroupId ?? groupId,
      activeBefore,
      executable: Math.min(stat.executable, limit),
      manualReview: stat.manualReview,
      excluded: stat.excluded + Math.max(0, stat.executable - Math.min(stat.executable, limit)),
      activeAfter: activeBefore,
      limit: groupLimitText(activeBefore),
      reason: [...stat.reasons].slice(0, 2).join('；'),
    };
  }).filter((group) => group.executable + group.manualReview + group.excluded > 0).sort((left, right) => right.executable - left.executable || left.name.localeCompare(right.name));

  let remainingDailyExecution = 20;
  const allGroups: CandidateGroup[] = rawGroups.map((group) => {
    const executable = Math.min(group.executable, remainingDailyExecution);
    remainingDailyExecution -= executable;
    return { ...group, executable, excluded: group.excluded + Math.max(0, group.executable - executable) };
  });

  const executable = allGroups.reduce((sum, group) => sum + group.executable, 0);
  const manualReview = allGroups.reduce((sum, group) => sum + group.manualReview, 0);
  const excluded = allGroups.reduce((sum, group) => sum + group.excluded, 0);
  return {
    date,
    runId: `real-preview-${date}`,
    totals: { candidates: selectedLinks.length, executable, lowRisk: executable, manualReview, excluded, groups: allGroups.length },
    reasonBuckets: [...reasonCounts.entries()].map(([label, count]) => ({ label, count })).sort((left, right) => right.count - left.count),
    groups: allGroups,
    links: sortedLinks.slice(0, 12),
    exceptions: [
      { label: '人工复核', count: manualReview, action: '补数据/核对口径后再判断', examples: sortedLinks.filter((link) => link.decision === '人工复核').slice(0, 4).map((link) => `${link.groupName} ${link.productId}`) },
      { label: '排除刷新', count: excluded, action: '转化异常/新链观察/组内超限候补', examples: sortedLinks.filter((link) => link.decision === '排除').slice(0, 4).map((link) => `${link.groupName} ${link.productId}`) },
      { label: '真实数据说明', count: aggregates.length, action: '基于本地 14 天窗口聚合生成', examples: [`聚合商品 ${aggregates.length} 条`, `链接档案 ${registryContext.registry.length} 条`] },
    ],
  };
}

async function writePreviewJson(outputDir: string, date: string, deck: ReturnType<typeof buildInactiveRefreshPreviewDeck>): Promise<string> {
  const path = join(outputDir, 'card-previews', `daily-mission-inactive-refresh-preview-${date}.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(deck, null, 2)}\n`, 'utf8');
  return path;
}

function resultText(index: number, result: FeishuDeliveryResult): string {
  return result.sent ? `card ${index} sent via ${result.channel}` : `card ${index} failed via ${result.channel}: ${result.reason}`;
}

export async function runDailyMissionInactiveRefreshPreviewCli(
  argv = process.argv.slice(2),
  env: FeishuEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const date = readArg(argv, '--date') ?? new Date().toISOString().slice(0, 10);
  assertDate(date);
  await loadEnv();
  assertExplicitPersonalRecipient(env);
  const outputDir = readArg(argv, '--output-dir') ?? process.env.MT_AGENT_OUTPUT_DIR ?? 'output';
  const deck = hasFlag(argv, '--real') ? buildInactiveRefreshPreviewDeckFromPlan(await buildRealPreviewPlan(outputDir, date)) : buildInactiveRefreshPreviewDeck(date);
  const previewPath = await writePreviewJson(outputDir, date, deck);
  const personalEnv: FeishuEnv = { ...env, FEISHU_SEND_TO: 'personal' };
  const results: FeishuDeliveryResult[] = [];
  for (let index = 0; index < deck.cards.length; index += 1) {
    results.push(await sendFeishuCard(personalEnv, deck.cards[index], deck.fallbackTexts[index] ?? `Daily Mission 失活刷新预览 ${index + 1}`, fetchImpl));
  }
  console.log(`preview saved: ${previewPath}`);
  for (let index = 0; index < results.length; index += 1) console.log(resultText(index + 1, results[index]));
  const failed = results.find((result) => !result.sent);
  if (failed) throw new Error(`Daily Mission inactive refresh preview send failed: ${failed.reason}`);
  console.log(`Daily Mission 失活刷新新版预览已发送：${deck.cards.length} 张，日期 ${deck.date}。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDailyMissionInactiveRefreshPreviewCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
