import { describe, expect, it } from 'vitest';
import { isDashboardEmptyStateText } from '../src/crawler/dashboardCrawler.js';

describe('dashboard empty state detection', () => {
  it('recognizes Alipay no-data text shown on the visits page', () => {
    expect(isDashboardEmptyStateText('未查询到相关数据')).toBe(true);
    expect(isDashboardEmptyStateText(' 暂无数据 ')).toBe(true);
    expect(isDashboardEmptyStateText('商品名称 商品ID 频道访问次数 创建订单数')).toBe(false);
  });
});
