import { describe, expect, it } from 'vitest';
import { extractOverviewFromText } from '../src/publicTraffic/extractOverviewFromText.js';

describe('extractOverviewFromText', () => {
  it('extracts overview metrics from body snippet', () => {
    const text = '托管概况 1日 7日 30日 2026-06-08 曝光次数 4.83 万 较前日 +31.8% 商品访问次数 1,598 较前日 +8.93% 交易件数 26 较前日 -3.70% 交易金额 3,019 较前日 +1.82% 交易用户数 26 较前日 0.00% 交易转化率 2.37 % 较前日 -3.74%';
    const result = extractOverviewFromText(text);
    expect(result).toEqual({
      exposure: 48300,
      visits: 1598,
      amount: 3019,
      conversionRate: 2.37,
    });
  });

  it('rounds compact count and money values to report-safe numbers', () => {
    const text = '曝光次数 3.26 万 商品访问次数 1,481 交易金额 2138 交易转化率 1.32 %';
    const result = extractOverviewFromText(text);
    expect(result).toEqual({
      exposure: 32600,
      visits: 1481,
      amount: 2138,
      conversionRate: 1.32,
    });
  });

  it('returns null when metrics not found', () => {
    expect(extractOverviewFromText('暂无数据')).toBeNull();
  });
});
