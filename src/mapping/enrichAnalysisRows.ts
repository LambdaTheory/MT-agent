import { access } from 'node:fs/promises';
import type { ProductAnalysisRow } from '../domain/types.js';
import { applyProductIdMapping, loadProductIdMapping } from './productIdMapping.js';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function enrichAnalysisRowsWithMapping(rows: ProductAnalysisRow[], mappingPath?: string): Promise<ProductAnalysisRow[]> {
  if (!mappingPath || !(await exists(mappingPath))) {
    return applyProductIdMapping(rows, {});
  }

  return applyProductIdMapping(rows, await loadProductIdMapping(mappingPath));
}
