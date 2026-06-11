import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import XLSX from 'xlsx-js-style';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { annotateGoodsExportWorkbookWithInternalId } from '../src/mapping/annotateGoodsExportWorkbook.js';

describe('annotateGoodsExportWorkbookWithInternalId', () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'goods-export-'));
    filePath = join(dir, 'goods.xlsx');
    const aoa = [
      ['商品名称', '商家侧编码', '平台侧编码', '价格'],
      ['商品A', '81665859-762-06081446', 'P1', '10'],
      ['商品B', '284', 'P2', '20'],
      ['商品C', '333-1', 'P3', '30'],
      ['商品D', 'ABC', 'P4', '40'],
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1');
    XLSX.writeFile(workbook, filePath);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('在商家侧编码右侧插入端内ID列', () => {
    const annotated = annotateGoodsExportWorkbookWithInternalId(filePath);
    expect(annotated).toBe(3);
    const workbook = XLSX.readFile(filePath);
    const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' });
    expect(rows[0]).toEqual(['商品名称', '商家侧编码', '端内ID', '平台侧编码', '价格']);
    expect(rows[1][2]).toBe('762');
    expect(rows[2][2]).toBe('284');
    expect(rows[3][2]).toBe('333');
    expect(rows[4][2]).toBe('');
  });

  it('已存在端内ID列时幂等返回0', () => {
    annotateGoodsExportWorkbookWithInternalId(filePath);
    expect(annotateGoodsExportWorkbookWithInternalId(filePath)).toBe(0);
    const workbook = XLSX.readFile(filePath);
    const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' });
    expect(rows[0]).toEqual(['商品名称', '商家侧编码', '端内ID', '平台侧编码', '价格']);
  });

  it('缺少商家侧编码列时抛错', () => {
    const aoa = [['商品名称'], ['商品A']];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1');
    XLSX.writeFile(workbook, filePath);
    expect(() => annotateGoodsExportWorkbookWithInternalId(filePath)).toThrow('商家侧编码');
  });
});
