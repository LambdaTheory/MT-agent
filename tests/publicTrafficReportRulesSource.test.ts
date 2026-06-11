import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('publicTrafficReport rules wiring', () => {
  it('merges exposure and dashboard data before generating report outputs', async () => {
    const source = await readFile(new URL('../src/cli/publicTrafficReport.ts', import.meta.url), 'utf8');

    expect(source).not.toContain("import { analyzePublicTraffic } from '../publicTraffic/analyzePublicTraffic.js';");
    expect(source).not.toContain("import { loadPublicTrafficRulesConfig } from '../publicTraffic/rulesConfig.js';");
    expect(source).not.toContain('analysis.exposureOptimization');
    expect(source).not.toContain('analysis.conversionOptimization');
    expect(source).not.toContain('analysis.newProductObservation');
    expect(source).not.toContain('analysis.lifecycleGovernance');
    expect(source).toContain("import { loadRecentExposureDeltas } from '../publicTraffic/recentExposureDeltas.js';");
    expect(source).toContain("import { mergePublicTrafficData } from '../publicTraffic/mergePublicTrafficData.js';");
    expect(source).toContain("import { analyzePublicTrafficData } from '../publicTraffic/analyzePublicTrafficData.js';");
    expect(source).toContain("import { buildPublicTrafficCard } from '../publicTraffic/buildPublicTrafficCard.js';");
    expect(source).toContain("import { sendFeishuCard } from '../notify/feishu.js';");
    expect(source).toContain('aggregateExposureDeltas(sevenDayDeltas)');
    expect(source).toContain('aggregateExposureDeltas(thirtyDayDeltas)');
    expect(source).toContain('paths.exposure7dSummary');
    expect(source).toContain('paths.exposure30dSummary');
    expect(source.indexOf('const { goodsExportPath, exposure: crawlResult, dashboard: rawTables } = await crawlPublicTrafficSources(config, paths.goodsExportWorkbook);')).toBeLessThan(
      source.indexOf('mergePublicTrafficData({'),
    );
    expect(source.indexOf('mergePublicTrafficData({')).toBeLessThan(source.indexOf('analyzePublicTrafficData({'));
    expect(source).toContain('await writeFile(paths.reportContext, JSON.stringify(context, null, 2),');
    expect(source).toContain('await writeFile(paths.markdown, buildPublicTrafficMarkdown(context),');
    expect(source).toContain('await writeFile(paths.workbook, writePublicTrafficWorkbookBuffer(context));');
    expect(source).toContain('buildPublicTrafficCard(context,');
    expect(source).toContain('sendFeishuCard(env, card, fallbackText)');
  });
});
