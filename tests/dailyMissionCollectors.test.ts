import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createExposureCollector, createSalesCollector } from '../src/agentRuntime/dailyMissionCollectors.js';

describe('daily mission report collectors', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-collectors-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('throws when no report context exists so exposure is marked missing', async () => {
    const collector = createExposureCollector('/nonexistent-output-dir');

    await expect(collector.collect({ runId: 'run-1', date: '2026-07-02', outputDir: '/nonexistent-output-dir' })).rejects.toThrow();
  });

  it('throws when no report context exists so sales is marked missing', async () => {
    const collector = createSalesCollector('/nonexistent-output-dir');

    await expect(collector.collect({ runId: 'run-1', date: '2026-07-02', outputDir: '/nonexistent-output-dir' })).rejects.toThrow();
  });

  it('does not use a latest report from a different date as the requested date context', async () => {
    const reportDir = join(dir, '2026-07-01');
    await mkdir(reportDir, { recursive: true });
    await writeFile(join(reportDir, 'report-context.json'), JSON.stringify({ date: '2026-07-01', summary: {}, rows: [] }), 'utf8');

    await expect(createExposureCollector(dir).collect({ runId: 'run-1', date: '2026-07-02', outputDir: dir })).rejects.toThrow('No public traffic report context for 2026-07-02');
  });
});
