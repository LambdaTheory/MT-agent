import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { sendFeishuCard as sendFeishuCardType } from '../src/notify/feishu.js';

const mocks = vi.hoisted(() => ({
  loadEnv: vi.fn(async () => undefined),
  sendFeishuCard: vi.fn<typeof sendFeishuCardType>(async () => ({ sent: true, channel: 'app' })),
}));

vi.mock('../src/config/loadEnv.js', () => ({
  loadEnv: mocks.loadEnv,
}));

vi.mock('../src/notify/feishu.js', () => ({
  sendFeishuCard: mocks.sendFeishuCard,
}));

describe('daily mission inactive refresh preview CLI', () => {
  beforeEach(() => {
    mocks.loadEnv.mockClear();
    mocks.sendFeishuCard.mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('sends the scheme B approval card to personal Feishu and saves JSON', async () => {
    const { runDailyMissionInactiveRefreshPreviewCli } = await import('../src/cli/dailyMissionInactiveRefreshPreview.js');
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-card-preview-'));

    await runDailyMissionInactiveRefreshPreviewCli(['--date', '2026-07-17', '--output-dir', outputDir], {
      FEISHU_APP_ID: 'app',
      FEISHU_APP_SECRET: 'secret',
      FEISHU_PERSONAL_RECEIVE_ID_TYPE: 'open_id',
      FEISHU_PERSONAL_RECEIVE_ID: 'ou_personal',
      FEISHU_SEND_TO: 'both',
    });

    expect(mocks.loadEnv).toHaveBeenCalledTimes(1);
    expect(mocks.sendFeishuCard).toHaveBeenCalledTimes(1);
    expect(mocks.sendFeishuCard.mock.calls[0][0]).toMatchObject({ FEISHU_SEND_TO: 'personal' });
    expect(JSON.stringify(mocks.sendFeishuCard.mock.calls[0][1])).toContain('今日失活刷新审批');
    expect(mocks.sendFeishuCard.mock.calls[0][2]).toContain('方案 B');
    const previewJson = await readFile(join(outputDir, 'card-previews', 'daily-mission-inactive-refresh-preview-2026-07-17.json'), 'utf8');
    expect(previewJson).toContain('方案 B｜标准指标');
    expect(previewJson).toContain('展开：数据异常/未执行原因');
    expect(previewJson).not.toContain('方案 A｜极简摘要');
    expect(previewJson).not.toContain('方案 C｜审计详情');
    expect(previewJson).not.toContain('失活刷新异常复核卡');
  });

  it('throws when any preview send fails', async () => {
    mocks.sendFeishuCard.mockResolvedValueOnce({ sent: false, channel: 'none', reason: 'missing config' });
    const { runDailyMissionInactiveRefreshPreviewCli } = await import('../src/cli/dailyMissionInactiveRefreshPreview.js');
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-card-preview-'));

    await expect(runDailyMissionInactiveRefreshPreviewCli(['--date=2026-07-17', '--output-dir', outputDir], {
      FEISHU_PERSONAL_RECEIVE_ID: 'ou_personal',
    })).rejects.toThrow('missing config');
  });

  it('rejects malformed dates before writing or sending', async () => {
    const { runDailyMissionInactiveRefreshPreviewCli } = await import('../src/cli/dailyMissionInactiveRefreshPreview.js');
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-card-preview-'));

    await expect(runDailyMissionInactiveRefreshPreviewCli(['--date', '../escape', '--output-dir', outputDir], {
      FEISHU_APP_ID: 'app',
      FEISHU_APP_SECRET: 'secret',
      FEISHU_PERSONAL_RECEIVE_ID: 'ou_personal',
    })).rejects.toThrow('date must be YYYY-MM-DD');
    expect(mocks.loadEnv).not.toHaveBeenCalled();
    expect(mocks.sendFeishuCard).not.toHaveBeenCalled();
  });

  it('requires an explicit personal recipient instead of generic receive id fallback', async () => {
    const { runDailyMissionInactiveRefreshPreviewCli } = await import('../src/cli/dailyMissionInactiveRefreshPreview.js');
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-card-preview-'));

    await expect(runDailyMissionInactiveRefreshPreviewCli(['--date', '2026-07-17', '--output-dir', outputDir], {
      FEISHU_APP_ID: 'app',
      FEISHU_APP_SECRET: 'secret',
      FEISHU_RECEIVE_ID_TYPE: 'chat_id',
      FEISHU_RECEIVE_ID: 'oc_group_fallback',
    })).rejects.toThrow('missing explicit Feishu personal recipient');
    expect(mocks.sendFeishuCard).not.toHaveBeenCalled();
  });
});
