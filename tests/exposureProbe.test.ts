import { describe, expect, it } from 'vitest';
import { summarizeExposureProbeText } from '../src/crawler/exposurePageProbe.js';

describe('summarizeExposureProbeText', () => {
  it('keeps useful visible controls and metrics', () => {
    expect(summarizeExposureProbeText(['曝光', '访问', '交易金额', '', '   ', '导出商品']).controls).toEqual(['曝光', '访问', '交易金额', '导出商品']);
  });

  it('collapses internal whitespace runs into single spaces and trims', () => {
    expect(summarizeExposureProbeText(['  曝光\t数据  ', '访问\n\n量', '交易   金额']).controls).toEqual(['曝光 数据', '访问 量', '交易 金额']);
  });

  it('caps the controls list at 200 items', () => {
    const texts = Array.from({ length: 250 }, (_, index) => `控件${index}`);
    const { controls } = summarizeExposureProbeText(texts);
    expect(controls).toHaveLength(200);
    expect(controls[0]).toBe('控件0');
    expect(controls[199]).toBe('控件199');
  });
});
