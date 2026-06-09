import { describe, expect, it } from 'vitest';
import { findGoodsExportMenuText } from '../src/crawler/goodsExportCrawler.js';

describe('goods export crawler helpers', () => {
  it('finds the first export-like menu item text', () => {
    expect(findGoodsExportMenuText(['批量修改', '导出商品', '删除'])).toBe('导出商品');
    expect(findGoodsExportMenuText(['下载商品信息', '其他'])).toBe('下载商品信息');
  });

  it('prefers exporting all goods over disabled selected-goods export', () => {
    expect(findGoodsExportMenuText(['导出已选商品(0)', '导出全部商品'])).toBe('导出全部商品');
  });

  it('returns null when no export-like menu item exists', () => {
    expect(findGoodsExportMenuText(['批量修改', '删除'])).toBeNull();
  });
});
