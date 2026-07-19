import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface RentalPriceRollbackActionItem {
  productId: string;
  taskId: string;
}

interface StoredRentalPriceRollbackAction {
  ref: string;
  createdAt: string;
  items: RentalPriceRollbackActionItem[];
}

function actionDir(outputDir: string): string {
  return join(outputDir, 'latest', 'rental-price-rollback-actions');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function actionKey(ref: string, items: RentalPriceRollbackActionItem[]): string {
  return createHash('sha256').update(JSON.stringify({ ref, items })).digest('hex').slice(0, 24);
}

export async function saveRentalPriceRollbackAction(outputDir: string, items: RentalPriceRollbackActionItem[]): Promise<{ rollbackRef: string; confirmationKey: string }> {
  const hash = createHash('sha256').update(JSON.stringify(items)).digest('hex').slice(0, 16);
  const rollbackRef = `rental_price_rollback_${Date.now()}_${hash}`;
  const record: StoredRentalPriceRollbackAction = { ref: rollbackRef, createdAt: new Date().toISOString(), items };
  const dir = actionDir(outputDir);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${rollbackRef}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return { rollbackRef, confirmationKey: actionKey(rollbackRef, items) };
}

export async function loadRentalPriceRollbackAction(outputDir: string, value: unknown): Promise<RentalPriceRollbackActionItem[] | null> {
  if (!isRecord(value)) return null;
  const rollbackRef = typeof value.rollbackRef === 'string' && /^rental_price_rollback_\d+_[a-f0-9]{16}$/.test(value.rollbackRef) ? value.rollbackRef : null;
  const confirmationKeyValue = value.contextConfirmationKey ?? value.confirmationKey;
  const confirmationKey = typeof confirmationKeyValue === 'string' && /^[a-f0-9]{24}$/.test(confirmationKeyValue) ? confirmationKeyValue : null;
  if (!rollbackRef || !confirmationKey) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(join(actionDir(outputDir), `${rollbackRef}.json`), 'utf8'));
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.ref !== rollbackRef || !Array.isArray(parsed.items)) return null;
  const items = parsed.items.filter((item): item is RentalPriceRollbackActionItem => isRecord(item) && typeof item.productId === 'string' && typeof item.taskId === 'string');
  if (items.length !== parsed.items.length || actionKey(rollbackRef, items) !== confirmationKey) return null;
  return items;
}
