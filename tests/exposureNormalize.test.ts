import { describe, expect, it } from 'vitest';
import { normalizeExposureProductRows, parseMoney, parseNumberText } from '../src/publicTraffic/exposureNormalize.js';

describe('exposure normalization', () => {
  it('parses number and money text', () => {
    expect(parseNumberText('48,103.0')).toBe(48103);
    expect(parseNumberText('3.31%')).toBe(3.31);
    expect(parseMoney('¥3,018.80')).toBe(3018.8);
  });

  it('parses compact Chinese number units', () => {
    expect(parseNumberText('1.2万')).toBe(12000);
    expect(parseNumberText('3亿')).toBe(300000000);
    expect(parseMoney('¥1.5万')).toBe(15000);
  });

  it('normalizes exposure cumulative product rows', () => {
    const rows = normalizeExposureProductRows(
      ['商品名称', '商品ID', '曝光', '访问', '交易金额', '托管天数'],
      [['DJI Pocket 3', '2026052122000827682227', '5,801', '159', '¥119.00', '23天']],
    );

    expect(rows).toEqual([
      {
        productName: 'DJI Pocket 3',
        platformProductId: '2026052122000827682227',
        exposure: 5801,
        visits: 159,
        amount: 119,
        custodyDays: 23,
        raw: {
          商品名称: 'DJI Pocket 3',
          商品ID: '2026052122000827682227',
          曝光: '5,801',
          访问: '159',
          交易金额: '¥119.00',
          托管天数: '23天',
        },
      },
    ]);
  });

  it('prefers exact and specific headers over ambiguous generic matches', () => {
    const rows = normalizeExposureProductRows(
      ['平台商品ID', '商品名称', '曝光', '访问', '交易笔数', '交易金额'],
      [['2026052122000827682227', 'DJI Pocket 3', '1.2万', '159', '8', '¥199.00']],
    );

    expect(rows).toEqual([
      {
        productName: 'DJI Pocket 3',
        platformProductId: '2026052122000827682227',
        exposure: 12000,
        visits: 159,
        amount: 199,
        custodyDays: null,
        raw: {
          平台商品ID: '2026052122000827682227',
          商品名称: 'DJI Pocket 3',
          曝光: '1.2万',
          访问: '159',
          交易笔数: '8',
          交易金额: '¥199.00',
        },
      },
    ]);
  });

  it('maps product name from product title without falling back to product id columns', () => {
    const rows = normalizeExposureProductRows(
      ['平台商品ID', '商品标题', '曝光', '访问', '交易金额'],
      [['2026052122000827682227', 'DJI Pocket 3', '5,801', '159', '¥119.00']],
    );

    expect(rows[0]?.productName).toBe('DJI Pocket 3');
    expect(rows[0]?.platformProductId).toBe('2026052122000827682227');
  });

  it('maps amount from transaction amount instead of refund amount', () => {
    const rows = normalizeExposureProductRows(
      ['商品名称', '商品ID', '曝光', '访问', '退款金额', '交易金额'],
      [['DJI Pocket 3', '2026052122000827682227', '5,801', '159', '¥5.00', '¥119.00']],
    );

    expect(rows[0]?.amount).toBe(119);
  });

  it('does not use refund amount as amount fallback', () => {
    expect(() =>
      normalizeExposureProductRows(
        ['商品名称', '商品ID', '曝光', '访问', '退款金额'],
        [['DJI Pocket 3', '2026052122000827682227', '5,801', '159', '¥5.00']],
      ),
    ).toThrow('Missing exposure column');
  });
});
