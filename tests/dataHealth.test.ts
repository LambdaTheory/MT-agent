import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDataHealthReport } from '../src/agentData/dataHealth.js';

async function writeJson(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value), 'utf8');
}

describe('buildDataHealthReport', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-health-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('summarizes report context quality notes, order date, and missing-id sample count', async () => {
    const date = '2026-07-02';
    const dayDir = join(dir, date);
    await mkdir(dayDir, { recursive: true });
    await writeJson(join(dayDir, `公域数据上下文_${date}.json`), {
      date,
      dataQualityNotes: ['30d 访问页缺失 2 条', '曝光页完整'],
      rows: [],
    });
    await writeJson(join(dayDir, `订单分析_${date}.json`), {
      pages: {
        overview: { dataDate: '2026-07-01' },
        delivery: { dataDate: '2026-07-01' },
      },
    });
    await writeJson(join(dayDir, `曝光无ID样本_${date}.json`), [{ raw: 'a' }, { raw: 'b' }, { raw: 'c' }]);

    await expect(buildDataHealthReport(dir, date)).resolves.toMatchObject({
      date,
      hasReportContext: true,
      dataQualityNotes: ['30d 访问页缺失 2 条', '曝光页完整'],
      missingIdSampleCount: 3,
      latestMissingIdSamplePath: join(dayDir, `曝光无ID样本_${date}.json`),
      orderAnalysisDate: '2026-07-01',
    });
  });

  it('returns an explicit no-data report instead of guessing when files are absent', async () => {
    await expect(buildDataHealthReport(dir, '2026-07-03')).resolves.toEqual({
      date: '2026-07-03',
      hasReportContext: false,
      dataQualityNotes: [],
      missingIdSampleCount: 0,
    });
  });
});
