import { describe, expect, it } from 'vitest';
import type { PeriodProductMetrics } from '../src/domain/types.js';
import { analyzeProducts } from '../src/analyzer/analyzeProducts.js';

function metric(period: PeriodProductMetrics['period'], overrides: Partial<PeriodProductMetrics>): PeriodProductMetrics {
  return {
    period,
    productName: '商品A',
    platformProductId: '10001',
    visits: 0,
    createdOrders: 0,
    signedOrders: 0,
    reviewedOrders: 0,
    shippedOrders: 0,
    ...overrides,
  };
}

describe('analyzeProducts', () => {
  it('marks 30-day high-visit products with no shipped orders as suspected inactive', () => {
    const rows = analyzeProducts([
      metric('1d', { visits: 12 }),
      metric('7d', { visits: 80 }),
      metric('30d', { visits: 300 }),
    ]);

    expect(rows[0]).toMatchObject({
      platformProductId: '10001',
      action: '疑似失活',
      riskLevel: '高',
      confidence: '高',
    });
    expect(rows[0]?.reason).toContain('30天访问300，发货0');
  });

  it('marks low exposure products with shipped orders as add more links', () => {
    const rows = analyzeProducts([
      metric('1d', { visits: 10, shippedOrders: 0 }),
      metric('7d', { visits: 68, shippedOrders: 2 }),
      metric('30d', { visits: 150, shippedOrders: 4 }),
    ]);

    expect(rows[0]).toMatchObject({
      action: '建议补链',
      opportunityLevel: '高',
    });
  });

  it('marks 30-day order signal with no 7-day shipment as pricing problem', () => {
    const rows = analyzeProducts([
      metric('1d', { visits: 15, shippedOrders: 0 }),
      metric('7d', { visits: 90, shippedOrders: 0 }),
      metric('30d', { visits: 400, createdOrders: 12, signedOrders: 5, reviewedOrders: 3, shippedOrders: 0 }),
    ]);

    expect(rows[0]).toMatchObject({
      action: '疑似价格问题',
      riskLevel: '高',
    });
  });

  it('prioritizes pricing issues before inactive risk', () => {
    const rows = analyzeProducts([
      metric('7d', { visits: 90, shippedOrders: 0 }),
      metric('30d', { visits: 400, createdOrders: 12, shippedOrders: 0 }),
    ]);

    expect(rows[0]?.action).toBe('疑似价格问题');
  });
});
