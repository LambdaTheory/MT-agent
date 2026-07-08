import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileHotspotEventProvider } from '../src/agentRuntime/hotspotEvents.js';

describe('FileHotspotEventProvider', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-hot-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns events within the lookahead window', async () => {
    const path = join(dir, 'hotspot-events.json');
    await writeFile(path, JSON.stringify([
      { eventId: 'e1', source: 'manual', title: '演唱会A', startsAt: '2026-07-03T00:00:00.000Z', affectedCategories: ['相机'], confidence: 'high' },
      { eventId: 'e2', source: 'manual', title: '演唱会B', startsAt: '2026-07-20T00:00:00.000Z', affectedCategories: ['相机'], confidence: 'low' },
    ]), 'utf8');

    const provider = new FileHotspotEventProvider({ path });

    await expect(provider.listEvents({ date: '2026-07-01', lookaheadDays: 7 }))
      .resolves.toMatchObject([{ eventId: 'e1' }]);
  });

  it('rejects when file is missing', async () => {
    const provider = new FileHotspotEventProvider({ path: join(dir, 'nope.json') });

    await expect(provider.listEvents({ date: '2026-07-01', lookaheadDays: 7 })).rejects.toThrow();
  });

  it('rejects when file contains malformed JSON', async () => {
    const path = join(dir, 'hotspot-events.json');
    await writeFile(path, '{broken', 'utf8');

    const provider = new FileHotspotEventProvider({ path });

    await expect(provider.listEvents({ date: '2026-07-01', lookaheadDays: 7 })).rejects.toThrow();
  });
});
