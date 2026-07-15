import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadRefreshSuppressionState,
  resolveRefreshSuppressionStatePath,
  shouldSuppressDelistAttribution,
  writeRefreshSuppressionState,
} from '../src/linkRegistry/refreshSuppressionState.js';

describe('link registry refresh suppression state', () => {
  let outputDir: string;

  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'mt-link-registry-refresh-suppression-'));
  });

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it('persists a same-date suppression record atomically', async () => {
    await writeRefreshSuppressionState(outputDir, {
      version: 1,
      referenceDate: '2026-07-15',
      suppressDelistAttribution: true,
    });

    await expect(loadRefreshSuppressionState(outputDir)).resolves.toEqual({
      version: 1,
      referenceDate: '2026-07-15',
      suppressDelistAttribution: true,
    });
    expect(resolveRefreshSuppressionStatePath(outputDir)).toBe(join(outputDir, 'state', 'link-registry-refresh-suppression.json'));
  });

  it('writes false to clear a prior same-date suppression', async () => {
    await writeRefreshSuppressionState(outputDir, {
      version: 1,
      referenceDate: '2026-07-15',
      suppressDelistAttribution: true,
    });
    await writeRefreshSuppressionState(outputDir, {
      version: 1,
      referenceDate: '2026-07-15',
      suppressDelistAttribution: false,
    });

    await expect(loadRefreshSuppressionState(outputDir)).resolves.toEqual({
      version: 1,
      referenceDate: '2026-07-15',
      suppressDelistAttribution: false,
    });
  });
  it('does not suppress when the persisted record belongs to a previous date', async () => {
    await writeRefreshSuppressionState(outputDir, {
      version: 1,
      referenceDate: '2026-07-14',
      suppressDelistAttribution: true,
    });

    const state = await loadRefreshSuppressionState(outputDir);
    expect(shouldSuppressDelistAttribution(state, '2026-07-15')).toBe(false);
  });

  it('treats a corrupt state file as no suppression', async () => {
    const path = resolveRefreshSuppressionStatePath(outputDir);
    await mkdir(join(outputDir, 'state'), { recursive: true });
    await writeFile(path, '{not json', 'utf8');

    await expect(loadRefreshSuppressionState(outputDir)).resolves.toBeNull();
  });
});
