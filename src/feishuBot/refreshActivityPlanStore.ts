import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseAgentToolConfirmContinuation, type AgentToolConfirmContinuation } from '../agentRuntime/approvalCard.js';

export interface RefreshActivityNewLinkItem {
  keyword: string;
  count: number;
  sourceProductId: string;
  sourceProductName: string;
  sameSkuGroupId?: string;
}

export interface RefreshActivityPlan {
  date: string;
  delistProductIds: string[];
  delistProductIdsForRefill?: string[];
  newLinkItemsForRefill: RefreshActivityNewLinkItem[];
  skippedGroups: string[];
  canRefill: boolean;
  continuation?: AgentToolConfirmContinuation;
}

type RefreshActivityStrategy = 'delist_only' | 'delist_and_refill';

interface StoredRefreshActivityPlan {
  ref: string;
  createdAt: string;
  plan: RefreshActivityPlan;
}

function refreshActivityPlanDir(outputDir: string): string {
  return join(outputDir, 'latest', 'refresh-activity-plans');
}

function refreshActivityPlanRef(plan: RefreshActivityPlan): string {
  const hash = createHash('sha256').update(JSON.stringify(plan)).digest('hex').slice(0, 16);
  return `refresh_plan_${Date.now()}_${hash}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function parseNewLinkItems(value: unknown): RefreshActivityNewLinkItem[] | null {
  if (!Array.isArray(value)) return null;
  const items: RefreshActivityNewLinkItem[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    if (typeof item.keyword !== 'string') return null;
    if (typeof item.count !== 'number') return null;
    if (typeof item.sourceProductId !== 'string') return null;
    if (typeof item.sourceProductName !== 'string') return null;
    if (item.sameSkuGroupId !== undefined && typeof item.sameSkuGroupId !== 'string') return null;
    items.push({
      keyword: item.keyword,
      count: item.count,
      sourceProductId: item.sourceProductId,
      sourceProductName: item.sourceProductName,
      ...(item.sameSkuGroupId === undefined ? {} : { sameSkuGroupId: item.sameSkuGroupId }),
    });
  }
  return items;
}

function parseRefreshActivityPlan(value: unknown): RefreshActivityPlan | null {
  if (!isRecord(value)) return null;
  if (typeof value.date !== 'string') return null;
  if (!isStringArray(value.delistProductIds)) return null;
  const delistProductIdsForRefill = value.delistProductIdsForRefill === undefined ? undefined : value.delistProductIdsForRefill;
  if (delistProductIdsForRefill !== undefined && !isStringArray(delistProductIdsForRefill)) return null;
  const newLinkItemsForRefill = parseNewLinkItems(value.newLinkItemsForRefill);
  if (!newLinkItemsForRefill) return null;
  if (!isStringArray(value.skippedGroups)) return null;
  if (typeof value.canRefill !== 'boolean') return null;
  const continuation = parseAgentToolConfirmContinuation(value.continuation);
  if (value.continuation !== undefined && !continuation) return null;
  return {
    date: value.date,
    delistProductIds: value.delistProductIds,
    ...(delistProductIdsForRefill === undefined ? {} : { delistProductIdsForRefill }),
    newLinkItemsForRefill,
    skippedGroups: value.skippedGroups,
    canRefill: value.canRefill,
    ...(continuation ? { continuation } : {}),
  };
}

export async function saveRefreshActivityPlan(outputDir: string, plan: RefreshActivityPlan): Promise<string> {
  const ref = refreshActivityPlanRef(plan);
  const dir = refreshActivityPlanDir(outputDir);
  await mkdir(dir, { recursive: true });
  const record: StoredRefreshActivityPlan = { ref, createdAt: new Date().toISOString(), plan };
  await writeFile(join(dir, `${ref}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return ref;
}

export async function loadRefreshActivityPlan(outputDir: string, planRef: string): Promise<RefreshActivityPlan | null> {
  const file = join(refreshActivityPlanDir(outputDir), `${planRef}.json`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch (_error) {
    return null;
  }
  if (!isRecord(parsed) || parsed.ref !== planRef) return null;
  return parseRefreshActivityPlan(parsed.plan);
}

export function refreshActivityPlanConfirmationKey(plan: RefreshActivityPlan, strategy: RefreshActivityStrategy): string {
  return createHash('sha256').update(`${JSON.stringify(plan)}${strategy}`).digest('hex').slice(0, 24);
}

export function verifyRefreshActivityPlanKey(plan: RefreshActivityPlan, strategy: string, suppliedKey: unknown): boolean {
  if ((strategy !== 'delist_only' && strategy !== 'delist_and_refill') || typeof suppliedKey !== 'string') return false;
  return refreshActivityPlanConfirmationKey(plan, strategy) === suppliedKey;
}
