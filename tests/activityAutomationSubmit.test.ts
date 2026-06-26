import { describe, expect, it } from 'vitest';
import {
  assessActivitySubmitOutcome,
  chooseActivitySubmitControl,
  chooseActivitySubmitModalConfirmControl,
  type ActivitySubmitControlCandidate,
} from '../src/activityAutomation/submit.js';

function candidate(overrides: Partial<ActivitySubmitControlCandidate> = {}): ActivitySubmitControlCandidate {
  return {
    index: 0,
    text: '',
    disabled: false,
    hidden: false,
    role: 'button',
    inDialog: false,
    ...overrides,
  };
}

describe('chooseActivitySubmitControl', () => {
  it('prefers the real submit button over generic confirm buttons', () => {
    const selected = chooseActivitySubmitControl([
      candidate({ index: 0, text: '\u786e\u5b9a' }),
      candidate({ index: 1, text: '\u63d0\u4ea4' }),
      candidate({ index: 2, text: '\u786e\u8ba4\u521b\u5efa' }),
    ]);

    expect(selected).toMatchObject({ index: 1, text: '\u63d0\u4ea4' });
  });

  it('ignores hidden and disabled controls', () => {
    const selected = chooseActivitySubmitControl([
      candidate({ index: 0, text: '\u63d0\u4ea4', hidden: true }),
      candidate({ index: 1, text: '\u63d0\u4ea4', disabled: true }),
      candidate({ index: 2, text: '\u4fdd\u5b58\u5e76\u63d0\u4ea4' }),
    ]);

    expect(selected).toMatchObject({ index: 2, text: '\u4fdd\u5b58\u5e76\u63d0\u4ea4' });
  });

  it('matches submit labels even when the UI inserts spaces between characters', () => {
    const selected = chooseActivitySubmitControl([
      candidate({ index: 0, text: '\u786e \u5b9a' }),
      candidate({ index: 1, text: '\u63d0 \u4ea4' }),
    ]);

    expect(selected).toMatchObject({ index: 1, text: '\u63d0 \u4ea4' });
  });
});

describe('chooseActivitySubmitModalConfirmControl', () => {
  it('only picks confirm buttons from a dialog after the first submit click', () => {
    const selected = chooseActivitySubmitModalConfirmControl([
      candidate({ index: 0, text: '\u786e\u5b9a', inDialog: false }),
      candidate({ index: 1, text: '\u53d6\u6d88', inDialog: true }),
      candidate({ index: 2, text: '\u786e\u8ba4\u63d0\u4ea4', inDialog: true }),
    ]);

    expect(selected).toMatchObject({ index: 2, text: '\u786e\u8ba4\u63d0\u4ea4' });
  });

  it('returns null when there is no visible dialog confirmation control', () => {
    expect(chooseActivitySubmitModalConfirmControl([
      candidate({ index: 0, text: '\u53d6\u6d88', inDialog: true }),
      candidate({ index: 1, text: '\u8fd4\u56de' }),
    ])).toBeNull();
  });

  it('matches spaced confirm labels inside dialogs', () => {
    const selected = chooseActivitySubmitModalConfirmControl([
      candidate({ index: 0, text: '\u786e \u5b9a', inDialog: true }),
    ]);

    expect(selected).toMatchObject({ index: 0, text: '\u786e \u5b9a' });
  });
});

describe('assessActivitySubmitOutcome', () => {
  it('confirms submit when the page navigates away from the form url', () => {
    expect(assessActivitySubmitOutcome({
      beforeUrl: 'https://example.com/form',
      afterUrl: 'https://example.com/list',
      beforeText: '提交前',
      afterText: '活动列表',
    })).toMatchObject({ confirmed: true, reason: 'url_changed' });
  });

  it('confirms submit when success text appears even if the url stays the same', () => {
    expect(assessActivitySubmitOutcome({
      beforeUrl: 'https://example.com/form',
      afterUrl: 'https://example.com/form',
      beforeText: '提交前',
      afterText: '创建成功 请返回活动列表查看',
    })).toMatchObject({ confirmed: true, reason: 'success_text' });
  });

  it('treats same-url text drift without a success signal as ambiguous instead of successful', () => {
    expect(assessActivitySubmitOutcome({
      beforeUrl: 'https://example.com/form',
      afterUrl: 'https://example.com/form',
      beforeText: '提交前',
      afterText: '如何确认是否注册成功',
    })).toMatchObject({ confirmed: false, reason: 'ambiguous' });
  });
});
