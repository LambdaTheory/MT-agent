import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('capture dashboard cli source', () => {
  it('loads env/config and calls dashboard refresh', () => {
    const source = readFileSync('src/cli/captureDashboard.ts', 'utf8');
    expect(source).toContain('loadEnv');
    expect(source).toContain('loadConfig');
    expect(source).toContain('runDashboardRefresh');
    expect(source).toContain('previousShanghaiDate');
    expect(source).toContain('assertDashboardDataDate');
    expect(source).toContain('dataDate');
    expect(source).toContain('--date');
    expect(source).toContain('--send-to');
  });

  it('package exposes capture-dashboard script', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.scripts['capture-dashboard']).toBe('tsx src/cli/captureDashboard.ts');
  });

  it('package exposes capture-dashboard-batch script with guarded env-loading cli', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const source = readFileSync('src/cli/captureDashboardBatch.ts', 'utf8');
    const loadEnvIndex = source.indexOf('await loadEnv()');
    const loadConfigIndex = source.indexOf('await loadConfig()');

    expect(pkg.scripts['capture-dashboard-batch']).toBe('tsx src/cli/captureDashboardBatch.ts');
    expect(source).toContain('pathToFileURL');
    expect(source).toContain('ensureAuthenticatedMerchantSession');
    expect(source).toContain('runDashboardBatchRecapture');
    expect(loadEnvIndex).toBeGreaterThan(-1);
    expect(loadConfigIndex).toBeGreaterThan(loadEnvIndex);
  });
});
