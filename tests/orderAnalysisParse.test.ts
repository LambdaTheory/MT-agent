import { describe, expect, it } from 'vitest';
import {
  businessMetricLines,
  cleanOrderAnalysisIndicator,
  derivedOrderBusinessMetrics,
  findOrderAnalysisIndicator,
  resolveOrderAnalysisDataDate,
  shortDataDate,
  type OrderAnalysisPageData,
} from '../src/publicTraffic/orderAnalysis.js';

describe('cleanOrderAnalysisIndicator', () => {
  it('清洗正常指标', () => {
    expect(cleanOrderAnalysisIndicator({ label: ' 签约订单数 ', value: ' 103 ', delta: ' 较前日+32.1% ' })).toEqual({
      label: '签约订单数',
      value: '103',
      delta: '较前日+32.1%',
    });
  });

  it('保留千分位与万单位数值原文', () => {
    expect(cleanOrderAnalysisIndicator({ label: '签约完成金额（元）', value: '3,977', delta: '较前日-25.6%' })).toEqual({
      label: '签约完成金额（元）',
      value: '3,977',
      delta: '较前日-25.6%',
    });
  });

  it('delta 缺失时为空字符串', () => {
    expect(cleanOrderAnalysisIndicator({ label: '平均发货天数', value: '3', delta: '' })).toEqual({ label: '平均发货天数', value: '3', delta: '' });
  });

  it('label 或 value 为空返回 null', () => {
    expect(cleanOrderAnalysisIndicator({ label: '', value: '103', delta: '' })).toBeNull();
    expect(cleanOrderAnalysisIndicator({ label: '签约订单数', value: '', delta: '' })).toBeNull();
  });
});

describe('resolveOrderAnalysisDataDate', () => {
  it('MM-DD 补全年份', () => {
    expect(resolveOrderAnalysisDataDate('06-10', '2026-06-11')).toBe('2026-06-10');
  });

  it('跨年回退到上一年', () => {
    expect(resolveOrderAnalysisDataDate('12-31', '2026-01-01')).toBe('2025-12-31');
  });

  it('完整 YYYY-MM-DD 原样通过', () => {
    expect(resolveOrderAnalysisDataDate('2026-06-10', '2026-06-11')).toBe('2026-06-10');
  });

  it('空值或非法格式返回 null', () => {
    expect(resolveOrderAnalysisDataDate('', '2026-06-11')).toBeNull();
    expect(resolveOrderAnalysisDataDate(null, '2026-06-11')).toBeNull();
    expect(resolveOrderAnalysisDataDate('请选择日期', '2026-06-11')).toBeNull();
  });
});

describe('findOrderAnalysisIndicator / shortDataDate', () => {
  const page: OrderAnalysisPageData = {
    key: 'overview',
    label: '标准订单分析',
    dataDate: '2026-06-10',
    indicators: [{ label: '创建订单数', value: '194', delta: '较前日+71.7%' }],
  };

  it('按标签优先级取值，缺失回退 -', () => {
    expect(findOrderAnalysisIndicator(page, ['创建订单数'])).toBe('194');
    expect(findOrderAnalysisIndicator(page, ['不存在', '创建订单数'])).toBe('194');
    expect(findOrderAnalysisIndicator(page, ['不存在'])).toBe('-');
    expect(findOrderAnalysisIndicator(undefined, ['创建订单数'])).toBe('-');
  });

  it('shortDataDate 截取月日，空值返回未知', () => {
    expect(shortDataDate('2026-06-10')).toBe('06-10');
    expect(shortDataDate(null)).toBe('未知');
  });
});

describe('derived order business metrics', () => {
  it('computes derived shipment rate, close rate, and average order value', () => {
    const overview = {
      key: 'overview' as const,
      label: '标准订单分析',
      dataDate: '2026-06-10',
      indicators: [
        { label: '创建订单数', value: '200', delta: '' },
        { label: '签约订单数', value: '100', delta: '' },
        { label: '发货订单数', value: '80', delta: '' },
        { label: '签约完成金额（元）', value: '4,000', delta: '' },
      ],
    };
    const customs = {
      key: 'customs' as const,
      label: '关单分析',
      dataDate: '2026-06-10',
      indicators: [{ label: '关单数', value: '70', delta: '' }],
    };

    expect(derivedOrderBusinessMetrics(overview, customs)).toEqual({
      shipmentRate: '40.00%',
      closeRate: '35.00%',
      closeRateStatus: '达标',
      averageOrderValue: '¥40.00',
    });
    expect(businessMetricLines(overview, customs)).toEqual(['发货率 40.00%｜关单率 35.00%（目标<=35%，达标）｜客单价 ¥40.00']);
  });

  it('marks close rate above 35 percent as risk and handles missing denominators', () => {
    const riskyOverview = {
      key: 'overview' as const,
      label: '标准订单分析',
      dataDate: '2026-06-10',
      indicators: [
        { label: '创建订单数', value: '100', delta: '' },
        { label: '签约订单数', value: '0', delta: '' },
        { label: '发货订单数', value: '20', delta: '' },
        { label: '签约完成金额（元）', value: '0', delta: '' },
      ],
    };
    const riskyCustoms = {
      key: 'customs' as const,
      label: '关单分析',
      dataDate: '2026-06-10',
      indicators: [{ label: '关单数', value: '36', delta: '' }],
    };

    expect(derivedOrderBusinessMetrics(riskyOverview, riskyCustoms)).toEqual({
      shipmentRate: '20.00%',
      closeRate: '36.00%',
      closeRateStatus: '风险',
      averageOrderValue: '-',
    });
  });

  it('formats unavailable close rate status in business metric lines', () => {
    expect(businessMetricLines(undefined, undefined)).toEqual([]);
    const noCreated = {
      key: 'overview' as const,
      label: '标准订单分析',
      dataDate: '2026-06-10',
      indicators: [
        { label: '创建订单数', value: '0', delta: '' },
        { label: '签约订单数', value: '0', delta: '' },
        { label: '发货订单数', value: '0', delta: '' },
        { label: '签约完成金额（元）', value: '0', delta: '' },
      ],
    };

    expect(businessMetricLines(noCreated, undefined)).toEqual(['发货率 -｜关单率 -（目标<=35%）｜客单价 -']);
  });
});
