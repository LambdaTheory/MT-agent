import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProductAnalysisRow } from '../src/domain/types.js';
import { applyProductIdMapping, loadProductIdMapping } from '../src/mapping/productIdMapping.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function baseRow(platformProductId: string): ProductAnalysisRow {
  return {
    productName: '商品A',
    platformProductId,
    metrics: { '1d': null, '7d': null, '30d': null },
    riskScore: 10,
    opportunityScore: 10,
    riskLevel: '低',
    opportunityLevel: '低',
    action: '继续观察',
    confidence: '低',
    reason: '继续观察',
  };
}

describe('product ID mapping', () => {
  it('loads a platform-to-internal product ID mapping file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-agent-map-'));
    tempDirs.push(dir);
    const path = join(dir, 'map.json');
    await writeFile(path, JSON.stringify({ '10001': 'jh-9001' }), 'utf8');

    await expect(loadProductIdMapping(path)).resolves.toEqual({ '10001': 'jh-9001' });
  });

  it('marks rows as mapped or unmapped', () => {
    const rows = applyProductIdMapping([baseRow('10001'), baseRow('10002')], { '10001': 'jh-9001' });

    expect(rows[0]).toMatchObject({ internalProductId: 'jh-9001', mappingStatus: 'mapped' });
    expect(rows[1]).toMatchObject({ internalProductId: '', mappingStatus: 'unmapped' });
  });
});
