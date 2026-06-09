import { describe, expect, it } from 'vitest';
import { buildPublicTrafficFeishuText } from '../src/publicTraffic/buildPublicTrafficFeishu.js';
import { buildPublicTrafficMarkdown } from '../src/publicTraffic/buildPublicTrafficMarkdown.js';

const context = {
  date: '2026-06-09',
  overview: [{ period: '1d' as const, exposure: 48103, visits: 1591, conversionRate: 3.31, amount: 3018.8 }],
  exposureOptimization: [{ identifier: '端内ID 558', action: '曝光优化', reason: '高曝光低访问' }],
  conversionOptimization: [{ identifier: '端内ID 421', action: '转化优化', reason: '有访问无金额' }],
  newProductObservation: [{ identifier: '端内ID 900', action: '新品观察', reason: '新品未进推广' }],
  lifecycleGovernance: [{ identifier: '端内ID 333', action: '生命周期治理', reason: '托管久且低曝光' }],
};

describe('public traffic report outputs', () => {
  it('builds markdown sections', () => {
    const markdown = buildPublicTrafficMarkdown(context);
    expect(markdown).toContain('# 公域流量日报 2026-06-09');
    expect(markdown).toContain('## 曝光优化');
    expect(markdown).toContain('端内ID 558');
  });

  it('builds medium-density Feishu text', () => {
    const text = buildPublicTrafficFeishuText(context, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
    expect(text).toContain('公域流量日报 2026-06-09');
    expect(text).toContain('曝光：48103');
    expect(text).toContain('新品观察：1个');
    expect(text).toContain('Markdown：report.md');
  });
});
