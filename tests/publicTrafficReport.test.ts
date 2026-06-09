import { describe, expect, it } from 'vitest';
import XLSX from 'xlsx-js-style';
import { buildPublicTrafficFeishuText } from '../src/publicTraffic/buildPublicTrafficFeishu.js';
import { buildPublicTrafficMarkdown } from '../src/publicTraffic/buildPublicTrafficMarkdown.js';
import { writePublicTrafficWorkbookBuffer } from '../src/publicTraffic/buildPublicTrafficWorkbook.js';
import type { PublicTrafficReportContext } from '../src/publicTraffic/types.js';

const context: PublicTrafficReportContext = {
  date: '2026-06-09',
  overview: [{ period: '1d', exposure: 48103, visits: 1591, conversionRate: 3.31, amount: 3018.8 }],
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

  it('renders 无 fallback for empty sections', () => {
    const empty: PublicTrafficReportContext = {
      ...context,
      exposureOptimization: [],
      conversionOptimization: [],
      newProductObservation: [],
      lifecycleGovernance: [],
    };
    const markdown = buildPublicTrafficMarkdown(empty);
    expect(markdown).toContain('## 曝光优化\n无');
    const text = buildPublicTrafficFeishuText(empty, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
    expect(text).toContain('曝光优化 Top5\n无');
  });

  it('truncates Feishu top5 to five items', () => {
    const many: PublicTrafficReportContext = {
      ...context,
      exposureOptimization: Array.from({ length: 8 }, (_, i) => ({
        identifier: `端内ID ${i + 1}`,
        action: '曝光优化',
        reason: `原因${i + 1}`,
      })),
    };
    const text = buildPublicTrafficFeishuText(many, { markdownPath: 'report.md', workbookPath: 'report.xlsx' });
    expect(text).toContain('5. 端内ID 5｜原因5');
    expect(text).not.toContain('6. 端内ID 6');
  });

  it('writes a workbook buffer with expected sheet names', () => {
    const buffer = writePublicTrafficWorkbookBuffer(context);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    expect(workbook.SheetNames).toEqual(['总览', '曝光优化', '转化优化', '新品观察', '生命周期治理']);
    const overview = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['总览']);
    expect(overview[0]).toMatchObject({ period: '1d', exposure: 48103 });
  });
});
