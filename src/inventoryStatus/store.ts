import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { InventoryStatusSnapshot } from './types.js';

function isEnoent(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}

export async function writeInventorySameSkuSnapshot(snapshot: InventoryStatusSnapshot, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

export async function readInventorySameSkuSnapshot(path: string): Promise<InventoryStatusSnapshot | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as InventoryStatusSnapshot;
  } catch (error) {
    if (isEnoent(error)) return null;
    throw error;
  }
}
