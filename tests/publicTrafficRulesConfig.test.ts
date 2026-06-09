import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG, loadPublicTrafficRulesConfig } from '../src/publicTraffic/rulesConfig.js';

describe('loadPublicTrafficRulesConfig', () => {
  it('uses defaults when config file is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-rules-'));
    try {
      await expect(loadPublicTrafficRulesConfig(join(dir, 'missing.json'))).resolves.toEqual(DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('merges partial config with defaults', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-rules-'));
    const path = join(dir, 'rules.json');
    try {
      await writeFile(path, JSON.stringify({ topN: 3, exposureOptimization: { highExposure: 500 } }), 'utf8');
      const config = await loadPublicTrafficRulesConfig(path);
      expect(config.topN).toBe(3);
      expect(config.exposureOptimization.highExposure).toBe(500);
      expect(config.exposureOptimization.lowVisitRate).toBe(DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG.exposureOptimization.lowVisitRate);
      expect(config.conversionOptimization.minVisits).toBe(DEFAULT_PUBLIC_TRAFFIC_RULES_CONFIG.conversionOptimization.minVisits);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects invalid values', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-rules-'));
    const path = join(dir, 'rules.json');
    try {
      await writeFile(path, JSON.stringify({ topN: 0, exposureOptimization: { lowVisitRate: 2 } }), 'utf8');
      await expect(loadPublicTrafficRulesConfig(path)).rejects.toThrow(/Invalid public traffic rules config/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects invalid topN type', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-rules-'));
    const path = join(dir, 'rules.json');
    try {
      await writeFile(path, JSON.stringify({ topN: '3' }), 'utf8');
      await expect(loadPublicTrafficRulesConfig(path)).rejects.toThrow(/Invalid public traffic rules config/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects invalid threshold type', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt-rules-'));
    const path = join(dir, 'rules.json');
    try {
      await writeFile(path, JSON.stringify({ exposureOptimization: { highExposure: '500' } }), 'utf8');
      await expect(loadPublicTrafficRulesConfig(path)).rejects.toThrow(/Invalid public traffic rules config/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
