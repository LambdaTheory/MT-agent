import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTrackRecord } from '../src/agentRuntime/trackRecord.js';

describe('buildTrackRecord', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-track-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('aggregates historical outcomes and writes track-record.json', async () => {
    for (const [date, outcome] of [['2026-07-01', 'positive'], ['2026-07-02', 'negative']] as const) {
      const missionDir = join(dir, 'daily-mission', date);
      await mkdir(missionDir, { recursive: true });
      await writeFile(join(missionDir, 'outcomes.json'), JSON.stringify([{
        decisionId: `dec-${date}`,
        runId: `run-${date}`,
        operationType: 'price_down',
        subject: { kind: 'product', id: '648', displayName: '相机' },
        executedAt: `${date}T00:00:00.000Z`,
        measuredAt: `${date}T00:00:00.000Z`,
        before: { exposure: 10 },
        after: { exposure: outcome === 'positive' ? 20 : 5 },
        outcome,
      }]), 'utf8');
    }

    const records = await buildTrackRecord(dir, { days: 7 });

    expect(records).toEqual([{ key: 'price_down', operationType: 'price_down', samples: 2, positive: 1, neutral: 0, negative: 1, successRate: 0.5 }]);
    const written = JSON.parse(await readFile(join(dir, 'track-record.json'), 'utf8')) as unknown;
    expect(written).toEqual(records);
  });
});
