import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalProductShortName, loadProductNameMap, resolveProductDisplayName } from '../src/publicTraffic/productDisplayName.js';
import type { PublicTrafficProductDataRow } from '../src/publicTraffic/types.js';

function row(productName: string): PublicTrafficProductDataRow {
  return {
    productName,
    platformProductId: 'P-1',
    displayProductId: '端内ID 565',
    custodyDays: 1,
    periods: {
      '1d': { exposure: 0, publicVisits: 0, dashboardVisits: 0, createdOrders: 0, signedOrders: 0, reviewedOrders: 0, shippedOrders: 0, amount: 0, exposureVisitRate: 0, visitCreatedOrderRate: 0, visitShipmentRate: 0, hasExposureData: true, hasDashboardData: true },
      '7d': { exposure: 0, publicVisits: 0, dashboardVisits: 0, createdOrders: 0, signedOrders: 0, reviewedOrders: 0, shippedOrders: 0, amount: 0, exposureVisitRate: 0, visitCreatedOrderRate: 0, visitShipmentRate: 0, hasExposureData: true, hasDashboardData: true },
      '30d': { exposure: 0, publicVisits: 0, dashboardVisits: 0, createdOrders: 0, signedOrders: 0, reviewedOrders: 0, shippedOrders: 0, amount: 0, exposureVisitRate: 0, visitCreatedOrderRate: 0, visitShipmentRate: 0, hasExposureData: true, hasDashboardData: true },
    },
  };
}

describe('product display names', () => {
  let dir = '';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'product-name-map-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('loads optional product name maps and ignores missing files', async () => {
    const path = join(dir, 'product-name-map.json');
    await writeFile(path, JSON.stringify({ '251': '佳能 SX70', empty: '  ', number: 123 }), 'utf8');

    await expect(loadProductNameMap(path)).resolves.toEqual({ '251': '佳能 SX70' });
    await expect(loadProductNameMap(join(dir, 'missing.json'))).resolves.toEqual({});
  });

  it('logs and ignores invalid product name maps', async () => {
    const warn = vi.fn();
    const path = join(dir, 'bad.json');
    await writeFile(path, '{bad json', 'utf8');

    await expect(loadProductNameMap(path, warn)).resolves.toEqual({});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('商品短名映射加载失败'));
  });

  it('removes rental and Apple brand noise from iPhone names', () => {
    expect(resolveProductDisplayName(row('一天起租 Apple 苹果 iPhone 17 Pro max'))).toBe('iPhone 17 Pro Max');
  });

  it('removes scenario and shipping noise from iPad names', () => {
    expect(resolveProductDisplayName(row('Apple 苹果 iPad mini6 2021款 游戏娱乐 学习办公 顺丰包邮'))).toBe('iPad mini6 2021款');
  });

  it('extracts compact DJI Pocket model names', () => {
    expect(resolveProductDisplayName(row('大疆Pocket 3口袋云台相机 .'))).toBe('大疆 Pocket 3');
  });

  it('extracts compact Canon model names', () => {
    expect(resolveProductDisplayName(row('佳能G7X2 网红同款 数码相机 冷白皮'))).toBe('佳能 G7X2');
    expect(resolveProductDisplayName(row('佳能 SX740HS 40倍光学变焦'))).toBe('佳能 SX740 HS');
  });

  it('extracts compact vivo model names', () => {
    expect(resolveProductDisplayName(row('vivo X200 Ultra 1天起租'))).toBe('vivo X200 Ultra');
  });

  it('extracts approved short model names from same-brand slash families', () => {
    expect(resolveProductDisplayName(row('松下 ZS220D 长焦相机 出游 旅游'))).toBe('松下 ZS220D');
    expect(resolveProductDisplayName(row('尼康 A900 长焦数码相机 演唱会'))).toBe('尼康 A900');
    expect(resolveProductDisplayName(row('富士 instax mini 12 拍立得 相纸套餐'))).toBe('富士 instax mini 12');
  });

  it('extracts approved accessory and lens short model names', () => {
    expect(resolveProductDisplayName(row('佳能 RF 100-400mm 长焦镜头'))).toBe('佳能 RF 100-400mm 镜头');
    expect(resolveProductDisplayName(row('vivo 蔡司增距镜 2.35× 演唱会神器'))).toBe('vivo 蔡司增距镜');
    expect(resolveProductDisplayName(row('富图宝 FY820 三脚架 轻便支架'))).toBe('富图宝 FY820 三脚架');
  });

  it('extracts approved camera and action camera short model names', () => {
    expect(resolveProductDisplayName(row('佳能 EOS R50 微单相机'))).toBe('佳能 EOS R50');
    expect(resolveProductDisplayName(row('影石 Insta360 Ace Pro 2 运动相机'))).toBe('影石 Insta360 Ace Pro 2');
    expect(resolveProductDisplayName(row('索尼 ZV-1 Vlog相机'))).toBe('索尼 ZV-1');
  });

  it('normalizes crawler spacing artifacts before approved model matching', () => {
    expect(resolveProductDisplayName(row('富士in tax SQUARE SQ1方形拍立得'))).toBe('富士 instax SQUARE SQ1');
    expect(resolveProductDisplayName(row('影石in ta360 Ace Pro2 运动相机'))).toBe('影石 Insta360 Ace Pro 2');
    expect(resolveProductDisplayName(row('大疆O mo Nano 自由视角运动相机'))).toBe('大疆 Osmo Nano');
  });
  it('strips marketing copy and keeps only the core brand model name', () => {
    expect(canonicalProductShortName('Ulike Air3 蓝宝石冰点脱毛仪 四周见效 全身无痛 脱毛家用')).toBe('Ulike Air 3');
    expect(canonicalProductShortName('富士 mini LiPlay 数模拍立得短租 旅游拍照神器')).toBe('富士 mini LiPlay');
    expect(canonicalProductShortName('mini liplay')).toBe('富士 mini LiPlay');
    expect(canonicalProductShortName('索尼 RX10M4 长焦相机 安全下车 演唱会神器')).toBe('索尼 RX10M4');
    expect(canonicalProductShortName('rx10m4')).toBe('索尼 RX10M4');
    expect(canonicalProductShortName('vivoX300Pro 百倍变焦 蔡司2亿APO')).toBe('vivo X300 Pro');
    expect(canonicalProductShortName('X200 Ultra')).toBe('vivo X200 Ultra');
    expect(canonicalProductShortName('pocket3')).toBe('大疆 Pocket 3');
  });
});
