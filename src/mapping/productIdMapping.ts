import { readFile } from 'node:fs/promises';
import type { ProductAnalysisRow } from '../domain/types.js';

export type ProductIdMapping = Record<string, string>;

export async function loadProductIdMapping(path: string): Promise<ProductIdMapping> {
  const content = await readFile(path, 'utf8');
  const parsed = JSON.parse(content) as unknown;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Product ID mapping must be a JSON object');
  }

  const mapping: ProductIdMapping = {};
  for (const [platformProductId, internalProductId] of Object.entries(parsed)) {
    if (typeof internalProductId !== 'string') {
      throw new Error(`Invalid internal product ID for ${platformProductId}`);
    }

    mapping[platformProductId] = internalProductId;
  }

  return mapping;
}

export function applyProductIdMapping(rows: ProductAnalysisRow[], mapping: ProductIdMapping): ProductAnalysisRow[] {
  return rows.map((row) => {
    const internalProductId = mapping[row.platformProductId] ?? '';
    return {
      ...row,
      internalProductId,
      mappingStatus: internalProductId ? 'mapped' : 'unmapped',
    };
  });
}
