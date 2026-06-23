import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { isKnownMutatingControlText } from '../src/activityAutomation/pageModel.js';

describe('activity automation safety', () => {
  it('marks known submit-like controls as mutating', () => {
    expect(isKnownMutatingControlText('提交')).toBe(true);
    expect(isKnownMutatingControlText('保存并提交')).toBe(true);
    expect(isKnownMutatingControlText('选择商品')).toBe(false);
  });

  it('keeps first implementation scout-only without submit workflow', async () => {
    const workflow = await readFile(new URL('../src/activityAutomation/workflow.ts', import.meta.url), 'utf8');
    expect(workflow).toContain('scoutActivityFormPage');
    expect(workflow).not.toContain('notifyLoginRequired');
    expect(workflow).not.toContain('process.env');
    expect(workflow).not.toContain('confirmSubmit: true');
    expect(workflow).not.toContain("getByText('提交').click");
    expect(workflow).not.toContain('waitForEvent(\'download\'');
  });
});
