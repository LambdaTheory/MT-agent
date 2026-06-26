import { describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { clickExportMenuItem, findGoodsExportMenuText } from '../src/crawler/goodsExportCrawler.js';

class FakeMenuItemLocator {
  constructor(private readonly state: { clickError?: Error; clicks: number; dispatched: string[] }) {}

  async waitFor(): Promise<void> {}

  async click(): Promise<void> {
    this.state.clicks += 1;
    if (this.state.clickError) throw this.state.clickError;
  }

  async dispatchEvent(type: string): Promise<void> {
    this.state.dispatched.push(type);
  }
}

class FakeMenuItemsLocator {
  constructor(private readonly texts: string[], private readonly state: { clickError?: Error; clicks: number; dispatched: string[] }) {}

  first(): FakeMenuItemLocator {
    return new FakeMenuItemLocator(this.state);
  }

  filter(): FakeMenuItemsLocator {
    return this;
  }

  async evaluateAll<T>(mapper: (nodes: Array<{ textContent: string }>) => T): Promise<T> {
    return mapper(this.texts.map((text) => ({ textContent: text })));
  }
}

function fakeMenuPage(texts: string[], state: { clickError?: Error; clicks: number; dispatched: string[] }): Page {
  return {
    locator() {
      return new FakeMenuItemsLocator(texts, state);
    },
  } as unknown as Page;
}

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

  it('reopens the export dropdown and dispatches click when the visible menu item is unstable', async () => {
    const state = {
      clickError: new Error('locator.click: Timeout 30000ms exceeded\n- element is not stable\n- element is not visible'),
      clicks: 0,
      dispatched: [] as string[],
    };
    let reopened = 0;

    await clickExportMenuItem(fakeMenuPage(['导出查询的全部商品'], state), async () => {
      reopened += 1;
    });

    expect(state.clicks).toBe(1);
    expect(reopened).toBe(1);
    expect(state.dispatched).toEqual(['click']);
  });
});
