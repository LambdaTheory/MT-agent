import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findPublicTrafficReportByDataDate } from '../src/publicTraffic/reportContextLocator.js';

it('locates a next-run directory by context data date instead of directory name', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-context-locator-'));
  const runDir = join(outputDir, '2026-07-14');
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, '公域数据上下文_2026-07-14.json'), JSON.stringify({ date: '2026-07-13', rows: [] }));

  await expect(findPublicTrafficReportByDataDate(outputDir, '2026-07-13')).resolves.toMatchObject({
    runDate: '2026-07-14',
    dir: runDir,
    context: { date: '2026-07-13' },
  });
});

it('does not treat a same-named run directory with a different context date as a match', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-context-locator-'));
  const runDir = join(outputDir, '2026-07-13');
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, '公域数据上下文_2026-07-13.json'), JSON.stringify({ date: '2026-07-12', rows: [] }));

  await expect(findPublicTrafficReportByDataDate(outputDir, '2026-07-13')).resolves.toBeNull();
});

it('propagates ENOENT when the output root does not exist', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'mt-agent-context-locator-'));
  const missingOutputDir = join(tempDir, 'missing-output-root');

  await expect(findPublicTrafficReportByDataDate(missingOutputDir, '2026-07-13')).rejects.toMatchObject({ code: 'ENOENT' });
});

it('propagates malformed context JSON instead of treating it as absent', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-context-locator-'));
  const runDir = join(outputDir, '2026-07-14');
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, '公域数据上下文_2026-07-14.json'), '{broken json');

  await expect(findPublicTrafficReportByDataDate(outputDir, '2026-07-13')).rejects.toThrow();
});
