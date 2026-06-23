import { describe, expect, it } from 'vitest';
import { mapPickedProductsToInternalIds, mergePickedProducts } from '../src/activityAutomation/productPickSession.js';

const period = {
  exposure: 10,
  publicVisits: 2,
  dashboardVisits: 2,
  createdOrders: 0,
  signedOrders: 0,
  reviewedOrders: 0,
  shippedOrders: 0,
  amount: 0,
  exposureVisitRate: 0.2,
  visitCreatedOrderRate: 0,
  visitShipmentRate: 0,
  hasExposureData: true,
  hasDashboardData: true,
};

describe('activity automation product pick session', () => {
  it('deduplicates picked products by platform product id while keeping first-seen order', () => {
    const merged = mergePickedProducts(
      [{ platformProductId: 'platform-1', merchantProductId: '81665859-787-061117004', productName: 'item-1', pickedOnPage: 1 }],
      [
        { platformProductId: 'platform-2', merchantProductId: '81665859-788-061116594', productName: 'item-2', pickedOnPage: 1 },
        { platformProductId: 'platform-1', merchantProductId: '81665859-787-061117004', productName: 'item-1-updated', pickedOnPage: 2 },
      ],
    );

    expect(merged).toEqual([
      { platformProductId: 'platform-1', merchantProductId: '81665859-787-061117004', productName: 'item-1', pickedOnPage: 1 },
      { platformProductId: 'platform-2', merchantProductId: '81665859-788-061116594', productName: 'item-2', pickedOnPage: 1 },
    ]);
  });

  it('maps picked products to internal ids from latest report context first, then merchant product id, and finally mapping file', () => {
    const result = mapPickedProductsToInternalIds(
      [
        { platformProductId: 'platform-1', merchantProductId: '81665859-787-061117004', productName: 'item-1', pickedOnPage: 1 },
        { platformProductId: 'platform-2', merchantProductId: '81665859-788-061116594', productName: 'item-2', pickedOnPage: 1 },
        { platformProductId: 'platform-3', merchantProductId: '81665859-789-061116596', productName: 'item-3', pickedOnPage: 2 },
        { platformProductId: 'platform-4', merchantProductId: 'plain-code-without-internal-id', productName: 'item-4', pickedOnPage: 2 },
      ],
      {
        date: '2026-06-23',
        summary: { '1d': period, '7d': period, '30d': period },
        conclusions: [],
        rows: [
          { productName: 'item-1', platformProductId: 'platform-1', displayProductId: '端内ID 565', custodyDays: 10, periods: { '1d': period, '7d': period, '30d': period } },
        ],
        lowExposure: [],
        weakClick: [],
        weakConversion: [],
        highPotential: [],
        newProductObservation: [],
        lifecycleGovernance: [],
        recommendedActions: [],
        emptySectionNotes: {
          lowExposure: '',
          weakClick: '',
          weakConversion: '',
          highPotential: '',
          newProductObservation: '',
          lifecycleGovernance: '',
          recommendedActions: '',
        },
      },
      { 'platform-4': '841' },
    );

    expect(result.mappedCount).toBe(4);
    expect(result.unmappedCount).toBe(0);
    expect(result.products).toEqual([
      {
        platformProductId: 'platform-1',
        merchantProductId: '81665859-787-061117004',
        productName: 'item-1',
        pickedOnPage: 1,
        internalProductId: '565',
        mappingSource: 'latest_report_context',
      },
      {
        platformProductId: 'platform-2',
        merchantProductId: '81665859-788-061116594',
        productName: 'item-2',
        pickedOnPage: 1,
        internalProductId: '788',
        mappingSource: 'merchant_product_id',
      },
      {
        platformProductId: 'platform-3',
        merchantProductId: '81665859-789-061116596',
        productName: 'item-3',
        pickedOnPage: 2,
        internalProductId: '789',
        mappingSource: 'merchant_product_id',
      },
      {
        platformProductId: 'platform-4',
        merchantProductId: 'plain-code-without-internal-id',
        productName: 'item-4',
        pickedOnPage: 2,
        internalProductId: '841',
        mappingSource: 'product_id_map',
      },
    ]);
  });
});
