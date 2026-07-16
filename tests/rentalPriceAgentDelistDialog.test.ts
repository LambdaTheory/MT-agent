import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const requireRunner = createRequire(import.meta.url);
const runner = requireRunner('../vendor/rental-price-agent/scripts/playwright-runner.js') as {
  checkExpectedProductUrl(url: string, expectedProductId: string, productDetailUrlTemplate?: string): { ok: boolean; reason?: string };
  validateSubmitCommand(command: Record<string, unknown>): void;
};
const batchRunner = requireRunner('../vendor/rental-price-agent/scripts/batch-runner.js') as {
  buildSubmitCommand(productId: string): Record<string, unknown>;
};
const registry = requireRunner('../vendor/rental-price-agent/scripts/lib/action-registry.js') as {
  classifyAction(action: string): { classification: string; surfaces: string[] } | null;
};

describe('rental-price-agent stable daemon contracts', () => {
  it('keeps delist classified as a daemon mutation', () => {
    expect(registry.classifyAction('delist')).toMatchObject({ classification: 'mutation', surfaces: expect.arrayContaining(['daemon', 'legacy']) });
  });

  it('requires submit to bind the expected product id', () => {
    expect(batchRunner.buildSubmitCommand('761')).toEqual({ action: 'submit', expectedProductId: '761' });
    expect(runner.validateSubmitCommand({ action: 'submit' })).toMatchObject({ status: 'error' });
  });

  it('validates canonical goods edit URLs before submit', () => {
    const template = 'https://example.com/app/index.php?c=site&a=entry&m=ewei_shopv2&do=web&r=goods.edit&id={productId}';
    expect(runner.checkExpectedProductUrl('https://example.com/app/index.php?c=site&a=entry&m=ewei_shopv2&do=web&r=goods.edit&id=761', '761', template)).toMatchObject({ ok: true });
    expect(runner.checkExpectedProductUrl('https://example.com/app/index.php?c=site&a=entry&m=ewei_shopv2&do=web&r=goods.edit&id=762', '761', template)).toMatchObject({ ok: false });
  });
});
