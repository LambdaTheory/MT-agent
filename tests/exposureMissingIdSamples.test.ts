import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { extractProductRows } from '../src/crawler/exposureCrawler.js';

type ExposureTable = {
  headers: string[];
  rows: Array<{ cells: string[]; productTitle: string; domProductId: string; statusLabel: string }>;
  signature: string;
};

function fakePage(table: ExposureTable): Page {
  return {
    async evaluate(source: string) {
      if (source.includes('return { headers, rows, signature }')) return table;
      if (source.includes('nextButton.click')) return false;
      if (source.includes('scrollableElements')) return false;
      if (source.includes('return { x: rect.left')) return null;
      if (source.includes('target.tabIndex')) return false;
      return false;
    },
    mouse: {
      async move() {},
      async wheel() {},
    },
    keyboard: {
      async press() {},
    },
    async waitForTimeout() {},
  } as unknown as Page;
}

function missingIdRow(index: number) {
  const infoText = `无ID商品 ${index} 出售中`;
  return {
    cells: [infoText, String(index), '0', '0'],
    productTitle: `无ID商品 ${index}`,
    domProductId: '',
    statusLabel: '出售中',
  };
}

describe('exposure missing product id samples', () => {
  it('captures raw samples for rows without DOM or regex product IDs', async () => {
    const result = await extractProductRows(fakePage({
      headers: ['商品信息', '曝光次数', '商品访问次数', '交易金额'],
      rows: [missingIdRow(1)],
      signature: 'missing-one',
    }), {});

    expect(result.paginationStats.skippedProductIdRows).toBe(1);
    expect(result.paginationStats.missingProductIdSamples).toEqual([
      {
        page: 1,
        productTitle: '无ID商品 1',
        infoText: '无ID商品 1 出售中',
        statusLabel: '出售中',
        cells: ['无ID商品 1 出售中', '1', '0', '0'],
      },
    ]);
  });

  it('caps missing product id samples at 20 rows', async () => {
    const rows = Array.from({ length: 25 }, (_, index) => missingIdRow(index + 1));

    const result = await extractProductRows(fakePage({
      headers: ['商品信息', '曝光次数', '商品访问次数', '交易金额'],
      rows,
      signature: 'missing-many',
    }), {});

    expect(result.paginationStats.skippedProductIdRows).toBe(25);
    const samples = result.paginationStats.missingProductIdSamples ?? [];
    expect(samples).toHaveLength(20);
    expect(samples.at(-1)?.productTitle).toBe('无ID商品 20');
  });
});
