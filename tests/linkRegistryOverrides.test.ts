import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyLinkRegistryOverrides, parseLinkRegistryOverrides } from '../src/linkRegistry/overrides.js';
import type { LinkRegistryEntry } from '../src/linkRegistry/types.js';

const entries: LinkRegistryEntry[] = [
  { internalProductId: '701', platformProductId: 'platform-701', productName: 'Insta360 Ace Pro 2 Full Kit', shortName: 'Old short name', sameSkuGroupId: 'old-group', status: 'active', source: ['product_id_mapping'] },
  { internalProductId: '702', platformProductId: 'platform-702', productName: 'Canon SX70', shortName: 'Canon SX70', status: 'removed', source: ['product_name_map'] },
  { internalProductId: '703', platformProductId: 'platform-703', productName: 'Unknown item', shortName: 'Unknown item', status: 'unknown', source: ['product_id_mapping'] },
];

describe('link registry overrides', () => {
  it('applies manual entry overrides before existing same sku group fields', () => {
    const result = applyLinkRegistryOverrides(entries, {
      version: 1,
      entries: [{ internalProductId: '701', categoryId: 'camera', categoryName: '相机', productType: 'canon-sx', shortName: 'Canon SX70', aliases: ['Ace pro 2'], sameSkuGroupId: 'canon-sx70', updatedAt: '2026-06-23' }],
    });

    expect(result.entries[0]).toMatchObject({ categoryId: 'camera', categoryName: '相机', productType: 'canon-sx', shortName: 'Canon SX70', sameSkuGroupId: 'canon-sx70', classificationSource: 'manual_override', updatedAt: '2026-06-23' });
    expect(result.entries[0]?.aliases).toEqual(expect.arrayContaining(['Ace pro 2']));
    expect(result.entries[0].source).toContain('link_registry_override');
    expect(result.risks).toEqual([]);
  });

  it('ignores disabled overrides and keeps the original entry behavior', () => {
    const result = applyLinkRegistryOverrides(entries, {
      version: 1,
      entries: [{ internalProductId: '701', categoryId: 'camera', sameSkuGroupId: 'canon-sx70', disabled: true }],
    });

    expect(result.entries[0]).toMatchObject({ shortName: 'Old short name', sameSkuGroupId: 'old-group' });
    expect(result.entries[0].classificationSource).toBeUndefined();
    expect(result.risks).toEqual([{ type: 'disabled_override', message: 'Disabled entry override ignored: 701', internalProductId: '701' }]);
  });

  it('classifies matching short names without changing unmatched entries', () => {
    const result = applyLinkRegistryOverrides(entries, {
      version: 1,
      shortNameRules: [{ shortName: 'Canon SX70', categoryId: 'camera', categoryName: '相机', productType: 'canon-sx', aliases: ['SX70 HS'], sameSkuGroupId: 'canon-sx70' }],
    });

    expect(result.entries[1]).toMatchObject({ categoryId: 'camera', productType: 'canon-sx', sameSkuGroupId: 'canon-sx70', classificationSource: 'short_name_rule' });
    expect(result.entries[1]?.aliases).toEqual(expect.arrayContaining(['SX70 HS']));
    expect(result.entries[2]).toBe(entries[2]);
  });

  it('applies same sku group alias rules to every matching entry', () => {
    const result = applyLinkRegistryOverrides(entries, {
      version: 1,
      entries: [{ internalProductId: '701', sameSkuGroupId: 'ace-pro-2' }],
      sameSkuGroupAliasRules: [{ sameSkuGroupId: 'ace-pro-2', aliases: ['Ace pro 2', 'AcePro2'] }],
    });

    expect(result.entries[0]?.aliases).toEqual(expect.arrayContaining(['Ace pro 2', 'AcePro2']));
    expect(result.entries[0]?.source).toContain('same_sku_group_alias_rule');
  });

  it('applies same sku group rules to every matching entry', () => {
    const result = applyLinkRegistryOverrides(entries, {
      version: 1,
      entries: [{ internalProductId: '701', sameSkuGroupId: 'canon r50' }],
      sameSkuGroupRules: [{ matchSameSkuGroupId: 'canon r50', sameSkuGroupId: 'canon-eos-r50', shortName: 'R50', aliases: ['EOS R50'] }],
    });

    expect(result.entries[0]).toMatchObject({
      sameSkuGroupId: 'canon-eos-r50',
      shortName: 'R50',
      classificationSource: 'manual_override',
    });
    expect(result.entries[0]?.aliases).toEqual(expect.arrayContaining(['EOS R50']));
    expect(result.entries[0]?.source).toContain('same_sku_group_rule');
    expect(result.risks).toEqual([]);
  });

  it('applies group-level classification fields from same sku group rules to all matching entries', () => {
    const result = applyLinkRegistryOverrides([
      { internalProductId: '901', shortName: 'R50', sameSkuGroupId: 'canon-eos-r50', categoryId: 'lens', categoryName: '镜头', productType: 'lens-accessory', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '902', shortName: 'R50', sameSkuGroupId: 'canon-eos-r50', status: 'active', source: ['daemon_catalog'] },
    ], {
      version: 1,
      sameSkuGroupRules: [{ matchSameSkuGroupId: 'canon-eos-r50', categoryId: 'camera', categoryName: '相机', productType: 'camera', shortName: 'R50' }],
    });

    expect(result.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ internalProductId: '901', sameSkuGroupId: 'canon-eos-r50', categoryId: 'camera', categoryName: '相机', productType: 'camera' }),
      expect.objectContaining({ internalProductId: '902', sameSkuGroupId: 'canon-eos-r50', categoryId: 'camera', categoryName: '相机', productType: 'camera' }),
    ]));
  });

  it('keeps manually reviewed same sku group short names instead of re-normalizing them back', () => {
    const result = applyLinkRegistryOverrides([
      { internalProductId: '801', productName: '富士 mini link3 手机照片打印机短租', shortName: 'Mini Link 3', sameSkuGroupId: 'fujifilm-instax-mini-link-3', status: 'active', source: ['daemon_catalog'] },
    ], {
      version: 1,
      sameSkuGroupRules: [{ matchSameSkuGroupId: 'fujifilm-instax-mini-link-3', shortName: 'mini Link 3' }],
    });

    expect(result.entries[0]).toMatchObject({
      internalProductId: '801',
      shortName: 'mini Link 3',
      sameSkuGroupId: 'fujifilm-instax-mini-link-3',
      classificationSource: 'manual_override',
    });
  });


  it('fails fast for duplicate manual overrides', () => {
    expect(() => applyLinkRegistryOverrides(entries, {
      version: 1,
      entries: [
        { internalProductId: '701', categoryId: 'camera' },
        { internalProductId: '701', categoryId: 'camera2' },
      ],
    })).toThrow('Duplicate manual override');
  });

  it('parses and rejects malformed override contracts', () => {
    expect(parseLinkRegistryOverrides({ version: 1, entries: [{ internalProductId: '701', sameSkuGroupId: 'canon-sx70' }], sameSkuGroupRules: [{ matchSameSkuGroupId: 'canon r50', sameSkuGroupId: 'canon-eos-r50', shortName: 'R50' }], sameSkuGroupAliasRules: [{ sameSkuGroupId: 'canon-sx70', aliases: ['SX70'] }] })).toEqual({ version: 1, entries: [{ internalProductId: '701', sameSkuGroupId: 'canon-sx70', productName: undefined, categoryId: undefined, categoryName: undefined, productType: undefined, shortName: undefined, aliases: undefined, status: undefined, confidence: undefined, reason: undefined, maintainer: undefined, updatedAt: undefined, disabled: undefined }], shortNameRules: undefined, sameSkuGroupRules: [{ matchSameSkuGroupId: 'canon r50', sameSkuGroupId: 'canon-eos-r50', productName: undefined, categoryId: undefined, categoryName: undefined, productType: undefined, shortName: 'R50', aliases: undefined, confidence: undefined, reason: undefined, maintainer: undefined, updatedAt: undefined, disabled: undefined }], sameSkuGroupAliasRules: [{ sameSkuGroupId: 'canon-sx70', aliases: ['SX70'], reason: undefined, maintainer: undefined, updatedAt: undefined, disabled: undefined }] });
    expect(() => parseLinkRegistryOverrides({ version: 1, entries: [{ internalProductId: 'bad', sameSkuGroupId: 'Canon SX70' }] })).toThrow('Invalid entry override internalProductId');
    expect(() => parseLinkRegistryOverrides({ version: 2 })).toThrow('version must be 1');
  });

  it('normalizes known broken same sku group ids instead of crashing the registry load', () => {
    const parsed = parseLinkRegistryOverrides({
      version: 1,
      entries: [{ internalProductId: '701', sameSkuGroupId: 'vivo-钄-2-35x-澧炶窛-绁炲櫒' }],
      shortNameRules: [{ shortName: 'broken vivo telephoto', sameSkuGroupId: 'vivo-钄-2-35x-澧炶窛-绁炲櫒' }],
      sameSkuGroupAliasRules: [{ sameSkuGroupId: 'vivo-钄-2-35x-澧炶窛-绁炲櫒', aliases: ['broken telephoto alias'] }],
    });

    expect(parsed.entries?.[0]?.sameSkuGroupId).toBe('vivo-zeiss-telephoto-lens');
    expect(parsed.shortNameRules?.[0]?.sameSkuGroupId).toBe('vivo-zeiss-telephoto-lens');
    expect(parsed.sameSkuGroupAliasRules?.[0]?.sameSkuGroupId).toBe('vivo-zeiss-telephoto-lens');
  });

  it('records unknown manual override targets without polluting entries', () => {
    const result = applyLinkRegistryOverrides(entries, { version: 1, entries: [{ internalProductId: '999', categoryId: 'camera' }] });

    expect(result.entries).toEqual(entries);
    expect(result.risks).toEqual([{ type: 'unknown_internal_product_id', message: 'Override target not found: 999', internalProductId: '999' }]);
  });

  it('seeds a manual entry when the override points to a live-only internal id', () => {
    const result = applyLinkRegistryOverrides(entries, {
      version: 1,
      entries: [{
        internalProductId: '999',
        productName: 'Ipod touch6 顺丰发货，1天起租---skills测试用，请勿下单',
        categoryId: 'media-player',
        categoryName: '播放器',
        productType: 'music-player',
        shortName: 'iPod touch 6',
        aliases: ['iPod touch 6', 'ipodtouch6'],
        sameSkuGroupId: 'ipod-touch-6',
        status: 'active',
        confidence: 0.95,
        updatedAt: '2026-06-27',
      }],
    });

    expect(result.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        internalProductId: '999',
        productName: 'Ipod touch6 顺丰发货，1天起租---skills测试用，请勿下单',
        categoryId: 'media-player',
        categoryName: '播放器',
        productType: 'music-player',
        shortName: 'iPod touch 6',
        sameSkuGroupId: 'ipod-touch-6',
        status: 'active',
        confidence: 0.95,
        classificationSource: 'manual_override',
        source: ['link_registry_override'],
      }),
    ]));
    expect(result.entries.find((entry) => entry.internalProductId === '999')?.aliases).toEqual(['iPod touch 6', 'ipodtouch6']);
    expect(result.risks).toEqual([]);
  });

  it('keeps the checked-in group normalization rules aligned for known dirty historical groups', () => {
    const overrides = parseLinkRegistryOverrides(
      JSON.parse(readFileSync(new URL('../config/link-registry-overrides.json', import.meta.url), 'utf8')) as unknown,
    );
    const sampleEntries: LinkRegistryEntry[] = [
      { internalProductId: '1001', shortName: 'pocket3', sameSkuGroupId: '89元租七天大疆限时抢购-大疆', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '1002', shortName: 'vivo X300 Pro', sameSkuGroupId: 'vivo x301 pro', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '1003', shortName: 'mini EVO', sameSkuGroupId: 'fujifilm-mini-evo', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '1004', shortName: 'vivo 蔡司增距镜', sameSkuGroupId: 'vivo-蔡司-2-35x增距镜-神器', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '1005', shortName: '富士 mini 99 拍立得 复古颜值自动曝光免押短租', sameSkuGroupId: 'fujifilm-mini-99-拍立得-复古颜值自动曝光免押短租', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '1006', shortName: '富士拍立得wide EVO 数码混合相机可打印宽幅照片', sameSkuGroupId: 'fujifilm wide evo', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '1007', shortName: '富图宝 FY820/830 三脚架', sameSkuGroupId: '富图宝-fy820-830-专业三脚架短租', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '1008', shortName: 'ixus 130', sameSkuGroupId: 'canon-ccd-ixus130-卡片相机-复古', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '1009', shortName: 'x100v', sameSkuGroupId: 'fujifilm-x100v-旁轴-复古胶片', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '1010', shortName: 'ZV-1', sameSkuGroupId: 'sony zv1', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '1011', shortName: '免押租vivoX200Ultra 神器长焦拍照手机', sameSkuGroupId: '免押租vivox200ultra-神器长焦拍照手机', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '1012', shortName: 'mini link2', sameSkuGroupId: 'fujifilm-mini-link2-手机照片打印机短', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '1013', shortName: 'mini se', sameSkuGroupId: 'fujifilm-instax-mini-se拍立得-自拍合影', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '1014', shortName: '佳能CCD ixus100is 带内置闪光灯 [CCD相机-佳能-IXUS 系列]', sameSkuGroupId: 'canon-ccd-ixus100is-带内置闪光灯-ccd相机-佳能-ixus-系列', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '1015', shortName: '佳能 RFS18-150mm 镜头旅游一镜走天下 追星高清体验', sameSkuGroupId: 'canon-rfs18-150mm-镜头旅游一镜走天下-追星高清体验', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '1016', shortName: '富士拍立得mini11 入门级拍立得', sameSkuGroupId: 'fujifilm-拍立得mini11-入门级拍立得', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '1017', shortName: '富士拍立得SQ20 数码混合相机 可打印方形照片', sameSkuGroupId: 'fujifilm-拍立得sq20-数码混合相机-可打印方形照片', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '1018', shortName: 'ipad air 7', sameSkuGroupId: 'ipad-air-7-2025款', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '1019', shortName: 'nikon a900', sameSkuGroupId: 'nikon-coolpix-a900-长焦相机-光学', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '1020', shortName: '大疆action6 漳州古城线下自提 YPX', sameSkuGroupId: '大疆action6-漳州古城线下自提-ypx', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '1021', shortName: '觅光 彩虹光面罩', sameSkuGroupId: '觅光-amiro-彩虹光面罩abm502', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '676', shortName: '富士X100V旁轴复古胶', sameSkuGroupId: 'fujifilm-x100v-旁轴-复古胶', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '679', shortName: '富士X100V旁轴复古胶片感街拍神器安心保', sameSkuGroupId: 'fujifilm-x100v-旁轴-复古胶片感街拍神器-安心保', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '694', shortName: 'vivo X300 Pro 镜头套装', sameSkuGroupId: 'vivo-x300-pro', categoryId: 'lens', categoryName: '镜头', productType: 'lens-accessory', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '851', shortName: '索尼 RX10M4', sameSkuGroupId: 'sony-rx10m4', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '969', shortName: '佳能G7', sameSkuGroupId: 'canon-g7', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '987', shortName: 'Wide 40', sameSkuGroupId: 'fujifilm-instax-wide-40', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '1030', shortName: '三星Galaxy S23Ultra短租特惠演唱', sameSkuGroupId: '三星galaxy-s23ultra短租特惠演唱', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '1031', shortName: 'vivo X300 Pro 镜头套装', sameSkuGroupId: 'vivo-x300-pro', categoryId: 'lens', categoryName: '镜头', productType: 'lens-accessory', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '2001', shortName: 'rf50f1.8', sameSkuGroupId: 'canon-rf-50-f1-8', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '2002', shortName: 'rfs18-150', sameSkuGroupId: 'canon-rf-s-18-150', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '2003', shortName: 'SEAYEO 乱码短名', sameSkuGroupId: 'seayeo-led-face-mask', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '2004', shortName: 'Action 6 乱码短名', sameSkuGroupId: 'dji-action-6', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '2005', shortName: 'Osmo Nano', sameSkuGroupId: 'dji-osmo-nano', status: 'active', source: ['daemon_catalog'] },
      { internalProductId: '2006', shortName: 'Insta360 GO3S', sameSkuGroupId: 'insta360-go3s', status: 'active', source: ['daemon_catalog'] },
    ];

    const result = applyLinkRegistryOverrides(sampleEntries, overrides);

    expect(result.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ internalProductId: '1001', shortName: 'Pocket 3', sameSkuGroupId: 'dji-pocket-3' }),
      expect.objectContaining({ internalProductId: '1002', shortName: 'vivo X300 Pro', sameSkuGroupId: 'vivo-x300-pro' }),
      expect.objectContaining({ internalProductId: '1003', shortName: 'mini EVO', sameSkuGroupId: 'fujifilm-instax-mini-evo' }),
      expect.objectContaining({ internalProductId: '1004', shortName: 'vivo 蔡司增距镜', sameSkuGroupId: 'vivo-zeiss-telephoto-lens' }),
      expect.objectContaining({ internalProductId: '1005', shortName: 'Mini 99', sameSkuGroupId: 'fujifilm-instax-mini-99' }),
      expect.objectContaining({ internalProductId: '1006', shortName: 'Wide EVO', sameSkuGroupId: 'fujifilm-instax-wide-evo' }),
      expect.objectContaining({ internalProductId: '1007', shortName: 'FY820/830 三脚架', sameSkuGroupId: 'fotopro-fy820-830-tripod' }),
      expect.objectContaining({ internalProductId: '1008', shortName: 'IXUS 130', sameSkuGroupId: 'canon-ixus-130' }),
      expect.objectContaining({ internalProductId: '1009', shortName: 'X100V', sameSkuGroupId: 'fujifilm-x100v' }),
      expect.objectContaining({ internalProductId: '1010', shortName: 'ZV-1', sameSkuGroupId: 'sony-zv1' }),
      expect.objectContaining({ internalProductId: '1011', shortName: 'x200 u', sameSkuGroupId: 'vivo-x200-ultra' }),
      expect.objectContaining({ internalProductId: '1012', shortName: 'Wide 400', sameSkuGroupId: 'fujifilm-instax-wide-400', productType: 'instant-camera' }),
      expect.objectContaining({ internalProductId: '1013', shortName: 'Wide 400', sameSkuGroupId: 'fujifilm-instax-wide-400', productType: 'instant-camera' }),
      expect.objectContaining({ internalProductId: '1014', shortName: 'IXUS 100IS', sameSkuGroupId: 'canon-ixus-100is' }),
      expect.objectContaining({ internalProductId: '1015', shortName: 'Wide 400', sameSkuGroupId: 'fujifilm-instax-wide-400', productType: 'instant-camera' }),
      expect.objectContaining({ internalProductId: '1016', shortName: 'Mini 11', sameSkuGroupId: 'fujifilm-instax-mini-11' }),
      expect.objectContaining({ internalProductId: '1017', shortName: 'SQ20', sameSkuGroupId: 'fujifilm-instax-square-sq20' }),
      expect.objectContaining({ internalProductId: '1018', shortName: 'iPad Air 7', sameSkuGroupId: 'ipad-air-7' }),
      expect.objectContaining({ internalProductId: '1019', shortName: 'A900', sameSkuGroupId: 'nikon-coolpix-a900' }),
      expect.objectContaining({ internalProductId: '1020', shortName: 'Action 6', sameSkuGroupId: 'dji-action-6' }),
      expect.objectContaining({ internalProductId: '1021', shortName: 'AMIRO ABM502', sameSkuGroupId: 'amiro-rainbow-light-mask-abm502', categoryId: 'beauty-device', productType: 'led-face-mask' }),
      expect.objectContaining({ internalProductId: '676', shortName: 'X100V', sameSkuGroupId: 'fujifilm-x100v' }),
      expect.objectContaining({ internalProductId: '679', shortName: 'X100V', sameSkuGroupId: 'fujifilm-x100v' }),
      expect.objectContaining({ internalProductId: '694', shortName: 'vivo X300 Pro', sameSkuGroupId: 'vivo-x300-pro', categoryId: 'phone', categoryName: '手机', productType: 'smartphone' }),
      expect.objectContaining({ internalProductId: '851', shortName: 'RX10M4', sameSkuGroupId: 'sony-rx10m4' }),
      expect.objectContaining({ internalProductId: '969', shortName: 'G7X2', sameSkuGroupId: 'canon-g7x2' }),
      expect.objectContaining({ internalProductId: '987', shortName: 'Wide 400', sameSkuGroupId: 'fujifilm-instax-wide-400', productType: 'instant-camera' }),
      expect.objectContaining({ internalProductId: '1030', shortName: 'S23U', sameSkuGroupId: 'samsung-galaxy-s23-ultra', categoryId: 'phone', productType: 'smartphone' }),
      expect.objectContaining({ internalProductId: '1031', shortName: 'vivo X300 Pro', sameSkuGroupId: 'vivo-x300-pro', categoryId: 'phone', categoryName: '手机', productType: 'smartphone' }),
      expect.objectContaining({ internalProductId: '2001', shortName: 'RF 50 F1.8', sameSkuGroupId: 'canon-rf-50-f1-8', categoryId: 'lens', productType: 'lens-accessory' }),
      expect.objectContaining({ internalProductId: '2002', shortName: 'RF-S 18-150', sameSkuGroupId: 'canon-rf-s-18-150', categoryId: 'lens', productType: 'lens-accessory' }),
      expect.objectContaining({ internalProductId: '2003', shortName: 'SEAYEO 大排灯美容仪', sameSkuGroupId: 'seayeo-led-face-mask', categoryId: 'beauty-device', productType: 'led-face-mask' }),
      expect.objectContaining({ internalProductId: '2004', shortName: 'Action 6', sameSkuGroupId: 'dji-action-6', categoryName: '运动相机', productType: 'action-camera' }),
      expect.objectContaining({ internalProductId: '2005', shortName: 'Osmo Nano', sameSkuGroupId: 'dji-osmo-nano', categoryName: '运动相机', productType: 'action-camera' }),
      expect.objectContaining({ internalProductId: '2006', shortName: 'Insta360 GO3S', sameSkuGroupId: 'insta360-go3s', categoryName: '运动相机', productType: 'action-camera' }),
    ]));
  });
});
