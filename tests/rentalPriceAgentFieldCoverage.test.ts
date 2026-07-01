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
      selectors?: { product?: Record<string, string> };
    };
    const productSelectors = config.selectors?.product ?? {};

    for (const field of expectedRentFields) {
      expect(productSelectors[field]).toBe(`input.option_${field}_{specId}`);
    }
  });

  it('keeps rent field metadata and rollback snapshots aligned with supported rent periods', () => {
    const diffGenerator = readText('vendor/rental-price-agent/scripts/diff-generator.js');
    const batchRunner = readText('vendor/rental-price-agent/scripts/batch-runner.js');

    for (const field of expectedRentFields) {
      expect(diffGenerator).toContain(field);
      expect(batchRunner).toContain(field);
    }
  });
});
