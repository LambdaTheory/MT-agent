import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('activity automation scout source', () => {
  it('writes a differential pricing analysis artifact while staying scout-only', async () => {
    const source = await readFile(new URL('../src/activityAutomation/scout.ts', import.meta.url), 'utf8');
    expect(source).toContain('activity-form-analysis.json');
    expect(source).toContain('analyzeDifferentialPricingScout');
    expect(source).not.toContain('confirmSubmit: true');
    expect(source).not.toContain("getByText('提交').click");
  });
});
