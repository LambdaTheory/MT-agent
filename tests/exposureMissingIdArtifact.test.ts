import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeExposureMissingProductIdSamplesArtifact } from '../src/cli/publicTrafficReport.js';
import type { MissingProductIdSample } from '../src/crawler/exposureCrawler.js';

describe('exposure missing product id artifact', () => {
  it('writes missing product id samples under the dated output directory and logs the path', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-missing-id-artifact-'));
    const events: string[] = [];
    const samples: MissingProductIdSample[] = [
      {
        page: 1,
        productTitle: '无ID商品',
        infoText: '无ID商品 出售中',
        statusLabel: '出售中',
        cells: ['无ID商品 出售中', '10', '1', '0'],
      },
    ];

    const artifactPath = await writeExposureMissingProductIdSamplesArtifact(outputDir, '2026-07-06', samples, {
      addEvent(message: string) { events.push(message); },
    });

    if (artifactPath === null) throw new Error('expected missing id sample artifact path');
    await expect(stat(artifactPath)).resolves.toMatchObject({ isFile: expect.any(Function) });
    expect(artifactPath).toBe(join(outputDir, '2026-07-06', '曝光无ID样本_2026-07-06.json'));
    expect(JSON.parse(await readFile(artifactPath, 'utf8'))).toEqual(samples);
    expect(events).toEqual([`无ID样本已落盘: ${artifactPath}`]);
  });

  it('does not write an artifact when there are no samples', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-empty-missing-id-artifact-'));
    const events: string[] = [];

    const artifactPath = await writeExposureMissingProductIdSamplesArtifact(outputDir, '2026-07-06', [], {
      addEvent(message: string) { events.push(message); },
    });

    expect(artifactPath).toBeNull();
    expect(events).toEqual([]);
  });
});
