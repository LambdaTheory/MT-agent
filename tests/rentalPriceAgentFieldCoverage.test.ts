import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const expectedRentFields = [
  'rent1day',
  'rent2day',
  'rent3day',
  'rent4day',
  'rent5day',
  'rent7day',
  'rent10day',
  'rent15day',
  'rent30day',
  'rent60day',
  'rent90day',
  'rent180day',
] as const;

function readText(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('rental price agent rent field coverage', () => {
  it('documents selectors for every supported SaaS rent period in the example config', () => {
    const config = JSON.parse(readText('vendor/rental-price-agent/config.example.json')) as {
      selectors?: { product?: { _dynamicFields?: { rentDays?: { scanSelector?: string; selectorTemplate?: string; fieldTemplate?: string; labelTemplate?: string } } } };
    };
    const rentDays = config.selectors?.product?._dynamicFields?.rentDays;

    expect(rentDays?.selectorTemplate).toBe('input.option_rent{days}day_{specId}');
    expect(rentDays?.scanSelector).toContain('option_rent');
    expect(rentDays?.fieldTemplate).toBe('rent{days}day');
    expect(rentDays?.labelTemplate).toContain('租金');
  });

  it('keeps dynamic rent field metadata and rollback snapshots aligned with supported rent periods', () => {
    const diffGenerator = readText('vendor/rental-price-agent/scripts/diff-generator.js');
    const batchRunner = readText('vendor/rental-price-agent/scripts/batch-runner.js');
    const playwrightRunner = readText('vendor/rental-price-agent/scripts/playwright-runner.js');

    expect(diffGenerator).toContain('FIELD_META');
    expect(diffGenerator).toContain('rent1day');
    expect(batchRunner).toContain('buildRollbackItem');
    expect(batchRunner).toContain('fields');
    expect(playwrightRunner).toContain('resolveDynamicRentSelector');
    for (const field of expectedRentFields) expect(field).toMatch(/^rent\d+day$/);
  });
});
