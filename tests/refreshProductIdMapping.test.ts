import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeProductIdMappingResult } from '../src/mapping/refreshProductIdMapping.js';

describe('writeProductIdMappingResult', () => {
  it('writes mapping and sync log', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-map-'));
    try {
      const mappingPath = join(dir, 'product-id-map.json');
      const logPath = join(dir, 'sync.log');
      const mapping = Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`platform-${index}`, `internal-${index}`]));

      const count = await writeProductIdMappingResult({
        exportPath: 'goods.xlsx',
        mappingPath,
        logPath,
        result: { mapping, skippedRows: [] },
      });

      expect(count).toBe(50);
      expect(JSON.parse(await readFile(mappingPath, 'utf8'))).toMatchObject({ 'platform-0': 'internal-0' });
      expect(await readFile(logPath, 'utf8')).toContain('source=goods.xlsx');
      expect(await readFile(logPath, 'utf8')).toContain('mappingCount=50');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses suspiciously small mapping output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-map-'));
    try {
      await expect(
        writeProductIdMappingResult({
          exportPath: 'goods.xlsx',
          mappingPath: join(dir, 'product-id-map.json'),
          logPath: join(dir, 'sync.log'),
          result: { mapping: { p1: 'i1' }, skippedRows: [] },
        }),
      ).rejects.toThrow('Refusing to write product ID mapping');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
