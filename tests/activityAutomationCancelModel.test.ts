import { describe, expect, it } from 'vitest';
import {
  chooseCancellationButtonLabel,
  extractActivityListProductIds,
  hydrateActivityCancellationProducts,
  matchesActivityListRow,
  simplifyCancellationProductName,
} from '../src/activityAutomation/cancelModel.js';

describe('activity cancellation model', () => {
  it('simplifies picked product names to the visible product title', () => {
    expect(simplifyCancellationProductName('\u9884\u89c8vivo X300Ultra \u5e73\u53f0\u4fa7\u7f16\u7801\uff1a2026061122000232520091 \u5546\u5bb6\u4fa7\u7f16\u7801\uff1a81665859-770-06111136'))
      .toBe('\u9884\u89c8vivo X300Ultra');
  });

  it('hydrates submit-session products with names from the pick session', () => {
    expect(hydrateActivityCancellationProducts(
      [
        {
          platformProductId: '2026061122000232520091',
          merchantProductId: '81665859-770-06111136',
          internalProductId: '770',
        },
      ],
      [
        {
          platformProductId: '2026061122000232520091',
          merchantProductId: '81665859-770-06111136',
          productName: '\u9884\u89c8vivo X300Ultra \u5e73\u53f0\u4fa7\u7f16\u7801\uff1a2026061122000232520091',
        },
      ],
    )).toEqual([
      {
        platformProductId: '2026061122000232520091',
        merchantProductId: '81665859-770-06111136',
        internalProductId: '770',
        productName: '\u9884\u89c8vivo X300Ultra \u5e73\u53f0\u4fa7\u7f16\u7801\uff1a2026061122000232520091',
      },
    ]);
  });

  it('matches an activity list row by product name and date range', () => {
    expect(matchesActivityListRow(
      {
        productName: '\u9884\u89c8vivo X300Ultra',
        activityTime: '2026-06-24 00:00:00 ~ 2026-06-30 23:59:59',
        status: '\u751f\u6548\u4e2d',
        operationText: '\u53d6\u6d88\u6d3b\u52a8',
      },
      {
        products: [
          {
            platformProductId: '2026061122000232520091',
            merchantProductId: '81665859-770-06111136',
            internalProductId: '770',
            productName: '\u9884\u89c8vivo X300Ultra \u5e73\u53f0\u4fa7\u7f16\u7801\uff1a2026061122000232520091',
          },
        ],
        startsAt: '2026-06-24',
        endsAt: '2026-06-30',
      },
    )).toBe(true);
  });

  it('accepts activity list end time rendered as the next day at midnight', () => {
    expect(matchesActivityListRow(
      {
        productName: '\u9884\u89c8vivo X300Ultra ID:\u5e73\u53f02026061122000232520091',
        activityTime: '\u8d77: 2026-06-24 00:00:00 \u6b62: 2026-07-01 00:00:00',
        status: '\u5df2\u53d1\u5e03',
        operationText: '\u79fb\u9664',
      },
      {
        products: [
          {
            platformProductId: '2026061122000232520091',
            merchantProductId: '81665859-770-06111136',
            internalProductId: '770',
            productName: '\u9884\u89c8vivo X300Ultra \u5e73\u53f0\u4fa7\u7f16\u7801\uff1a2026061122000232520091',
          },
        ],
        startsAt: '2026-06-24',
        endsAt: '2026-06-30',
      },
    )).toBe(true);
  });

  it('prefers explicit cancellation labels over generic ones', () => {
    expect(chooseCancellationButtonLabel(['\u67e5\u770b', '\u53d6\u6d88', '\u53d6\u6d88\u6d3b\u52a8'])).toBe('\u53d6\u6d88\u6d3b\u52a8');
  });

  it('treats 移除 as a valid cancellation action on the activity list', () => {
    expect(chooseCancellationButtonLabel(['\u67e5\u770b', '\u79fb\u9664'])).toBe('\u79fb\u9664');
  });

  it('prefers 批量删除 when batch cancellation controls are visible', () => {
    expect(chooseCancellationButtonLabel(['\u6279\u91cf\u4fee\u6539\u4f18\u60e0\u4ef7', '\u6279\u91cf\u5220\u9664', '\u79fb\u9664'])).toBe('\u6279\u91cf\u5220\u9664');
  });

  it('extracts product ids from activity list row text', () => {
    expect(extractActivityListProductIds('\u9884\u89c8vivo X300Ultra 商品ID 2026061122000232520091 商家编码 81665859-770-06111136 端内ID 770'))
      .toEqual({
        platformProductIds: ['2026061122000232520091'],
        merchantProductIds: ['81665859-770-06111136'],
        internalProductIds: ['770'],
      });
  });

  it('does not mistake activity dates for merchant product ids', () => {
    expect(extractActivityListProductIds('\u8d77: 2026-06-24 00:00:00 \u6b62: 2026-07-01 00:00:00 商家编码 81665859-870-06151612'))
      .toEqual({
        platformProductIds: [],
        merchantProductIds: ['81665859-870-06151612'],
        internalProductIds: [],
      });
  });
});
