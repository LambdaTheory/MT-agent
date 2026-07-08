import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const requireRunner = createRequire(import.meta.url);
const runner = requireRunner('../vendor/rental-price-agent/scripts/playwright-runner.js') as {
  normalizeDialogLabel(value: unknown): string;
  scoreConfirmButtonCandidate(candidate: unknown): number;
  chooseConfirmButtonIndex(candidates: unknown[]): number;
  classifyDelistRowStatus(rowText: string): { delisted: boolean; saleable: boolean; label: string };
};

describe('rental-price-agent delist dialog helpers', () => {
  it('prefers visible confirm buttons over cancel buttons', () => {
    const candidates = [
      { index: 0, count: 2, text: '取消', className: 'btn', visible: true, disabled: false },
      { index: 1, count: 2, text: '确认', className: 'btn btn-primary', visible: true, disabled: false },
    ];

    expect(runner.chooseConfirmButtonIndex(candidates)).toBe(1);
  });

  it('can use a primary button when the page text is mojibake', () => {
    const candidates = [
      { index: 0, count: 2, text: '鍙栨秷', className: 'btn', visible: true, disabled: false },
      { index: 1, count: 2, text: '纭畾', className: 'btn btn-primary', visible: true, disabled: false },
    ];

    expect(runner.chooseConfirmButtonIndex(candidates)).toBe(1);
  });

  it('rejects hidden and disabled confirm-like buttons', () => {
    expect(runner.scoreConfirmButtonCandidate({ index: 0, count: 1, text: '确认', visible: false })).toBe(-1);
    expect(runner.scoreConfirmButtonCandidate({ index: 0, count: 1, text: '确认', visible: true, disabled: true })).toBe(-1);
  });

  it('normalizes labels before scoring', () => {
    expect(runner.normalizeDialogLabel(' 确   定 ')).toBe('确定');
  });

  it('treats rows marked 已下架 as delisted even when they are still searchable', () => {
    const status = runner.classifyDelistRowStatus(
      '467 0 大疆 Osmo Nano 运动相机 2026-06-04 上架 展示 支付宝小程序，APP 已下架 大疆 Osmo Nano',
    );

    expect(status).toMatchObject({ delisted: true, saleable: false, label: '已下架' });
  });

  it('keeps rows marked 可售卖 as still active', () => {
    const status = runner.classifyDelistRowStatus(
      '472 0 佳能 G7X Mark II 2026-05-06 上架 展示 支付宝小程序，APP 可售卖 佳能 G7X Mark II',
    );

    expect(status).toMatchObject({ delisted: false, saleable: true, label: '可售卖' });
  });
});
