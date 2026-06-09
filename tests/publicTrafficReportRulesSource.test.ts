import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('publicTrafficReport rules wiring', () => {
  it('loads recent deltas, writes summaries, and fills report sections from analysis', async () => {
    const source = await readFile(new URL('../src/cli/publicTrafficReport.ts', import.meta.url), 'utf8');
    const rulesConfigIndex = source.indexOf('loadPublicTrafficRulesConfig()');
    const crawlIndex = source.indexOf('crawlExposurePage(config)');
    const cumulativeWriteIndex = source.indexOf('writeFile(paths.exposureCumulativeProducts');

    expect(source).toContain("import { analyzePublicTraffic } from '../publicTraffic/analyzePublicTraffic.js';");
    expect(source).toContain("import { loadPublicTrafficRulesConfig } from '../publicTraffic/rulesConfig.js';");
    expect(source).toContain("import { loadRecentExposureDeltas } from '../publicTraffic/recentExposureDeltas.js';");
    expect(rulesConfigIndex).toBeGreaterThan(-1);
    expect(crawlIndex).toBeGreaterThan(rulesConfigIndex);
    expect(cumulativeWriteIndex).toBeGreaterThan(rulesConfigIndex);
    expect(source).toContain('aggregateExposureDeltas(sevenDayDeltas)');
    expect(source).toContain('aggregateExposureDeltas(thirtyDayDeltas)');
    expect(source).toContain('paths.exposure7dSummary');
    expect(source).toContain('paths.exposure30dSummary');
    expect(source).toContain('analysis.exposureOptimization');
    expect(source).toContain('analysis.conversionOptimization');
    expect(source).toContain('analysis.newProductObservation');
    expect(source).toContain('analysis.lifecycleGovernance');
  });
});
