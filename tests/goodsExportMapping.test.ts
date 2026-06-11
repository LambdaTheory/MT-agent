import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import XLSX from 'xlsx-js-style';
import { afterEach, describe, expect, it } from 'vitest';
import { parseGoodsExportMapping } from '../src/mapping/goodsExportMapping.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function writeWorkbook(rows: unknown[][]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mt-agent-goods-export-'));
  tempDirs.push(dir);
  const path = join(dir, 'goods.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet0');
  XLSX.writeFile(workbook, path);
  return path;
}

describe('parseGoodsExportMapping', () => {
  it('extracts internal product IDs from merchant-side codes', async () => {
    const path = await writeWorkbook([
      ['商品名称', '商家侧编码', '平台侧编码', '售价'],
      ['商品A', '81665859-762-06081446', '2026060822000531936344', '11.76元/日'],
      ['商品B', '81665859-653-04281516', '2026042822000820052623', '2.64元/日'],
    ]);

    const result = parseGoodsExportMapping(path);

    expect(result.mapping).toEqual({
      '2026060822000531936344': '762',
      '2026042822000820052623': '653',
    });
    expect(result.skippedRows).toEqual([]);
  });

  it('uses numeric merchant-side codes as internal product ID fallback', async () => {
    const path = await writeWorkbook([
      ['商品名称', '商家侧编码', '平台侧编码'],
      ['商品A', '284', '2025122422000686849975'],
      ['商品B', '333-1', '2026011222000691436531'],
    ]);

    const result = parseGoodsExportMapping(path);

    expect(result.mapping).toEqual({
      '2025122422000686849975': '284',
      '2026011222000691436531': '333',
    });
    expect(result.skippedRows).toEqual([]);
  });

  it('skips rows with invalid merchant-side codes', async () => {
    const path = await writeWorkbook([
      ['商品名称', '商家侧编码', '平台侧编码'],
      ['商品A', 'bad-code', '2026060822000531936344'],
    ]);

    const result = parseGoodsExportMapping(path);

    expect(result.mapping).toEqual({});
    expect(result.skippedRows).toEqual([{ rowNumber: 2, platformProductId: '2026060822000531936344', merchantCode: 'bad-code', reason: 'invalid merchant code' }]);
  });
});
