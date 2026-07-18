import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { InactiveRefreshNewLinkItem, InactiveRefreshPlan } from './types.js';

interface StoredInactiveRefreshPlan {
  ref: string;
  createdAt: string;
  plan: InactiveRefreshPlan;
}

function planDir(outputDir: string): string {
  return join(outputDir, 'latest', 'inactive-refresh-plans');
}

export function isInactiveRefreshPlanRef(value: unknown): value is string {
  return typeof value === 'string' && /^inactive_refresh_\d+_[a-f0-9]{16}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function parseNewLinkItems(value: unknown): InactiveRefreshNewLinkItem[] | null {
  if (!Array.isArray(value)) return null;
  const items: InactiveRefreshNewLinkItem[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    if (typeof item.keyword !== 'string') return null;
    if (typeof item.count !== 'number' || !Number.isInteger(item.count) || item.count < 1) return null;
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

function parseInactiveRefreshPlan(value: unknown): InactiveRefreshPlan | null {
  if (!isRecord(value)) return null;
  if (typeof value.date !== 'string') return null;
  if (!isStringArray(value.delistProductIds)) return null;
  const newLinkItems = parseNewLinkItems(value.newLinkItems);
  if (!newLinkItems) return null;
  if (!isStringArray(value.skippedGroups)) return null;
  if (typeof value.executableCount !== 'number' || !Number.isInteger(value.executableCount) || value.executableCount < 0) return null;
  return {
    date: value.date,
    delistProductIds: value.delistProductIds,
    newLinkItems,
    skippedGroups: value.skippedGroups,
    executableCount: value.executableCount,
  };
}

function planRef(plan: InactiveRefreshPlan): string {
  const hash = createHash('sha256').update(JSON.stringify(plan)).digest('hex').slice(0, 16);
  return `inactive_refresh_${Date.now()}_${hash}`;
}

export async function saveInactiveRefreshPlan(outputDir: string, plan: InactiveRefreshPlan): Promise<string> {
  const ref = planRef(plan);
  const dir = planDir(outputDir);
  await mkdir(dir, { recursive: true });
  const record: StoredInactiveRefreshPlan = { ref, createdAt: new Date().toISOString(), plan };
  await writeFile(join(dir, `${ref}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return ref;
}

export async function loadInactiveRefreshPlan(outputDir: string, ref: string): Promise<InactiveRefreshPlan | null> {
  if (!isInactiveRefreshPlanRef(ref)) return null;
  try {
    const parsed = JSON.parse(await readFile(join(planDir(outputDir), `${ref}.json`), 'utf8')) as unknown;
    if (!isRecord(parsed) || parsed.ref !== ref) return null;
    return parseInactiveRefreshPlan(parsed.plan);
  } catch (_error) {
    return null;
  }
}

export function inactiveRefreshPlanConfirmationKey(plan: InactiveRefreshPlan): string {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex').slice(0, 24);
}

export function verifyInactiveRefreshPlanKey(plan: InactiveRefreshPlan, suppliedKey: unknown): boolean {
  return typeof suppliedKey === 'string' && inactiveRefreshPlanConfirmationKey(plan) === suppliedKey;
}

export type { InactiveRefreshPlan } from './types.js';
