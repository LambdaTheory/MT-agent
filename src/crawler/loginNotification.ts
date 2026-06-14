import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sendFeishuPersonalImage, sendFeishuText, type FeishuEnv } from '../notify/feishu.js';

export interface ScreenshotPage {
  screenshot(options?: { fullPage?: boolean; type?: 'png' }): Promise<Buffer | Uint8Array>;
}

export interface LoginNotificationOptions {
  page: ScreenshotPage;
  stage: string;
  outputDir: string;
  env?: FeishuEnv;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}

export type LoginNotificationResult = { notified: true; fileName: string } | { notified: false; reason: string };

const notifiedStages = new Set<string>();

export function resetLoginNotificationDedupeForTests(): void {
  notifiedStages.clear();
}

function timestampForFile(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function safeStage(stage: string): string {
  const safe = stage.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'login';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function notifyLoginRequired(options: LoginNotificationOptions): Promise<LoginNotificationResult> {
  const { page, stage, outputDir, fetchImpl = fetch, log } = options;
  const env = options.env ?? process.env;

  if (notifiedStages.has(stage)) {
    return { notified: false, reason: `already notified for stage ${stage}` };
  }
  notifiedStages.add(stage);

  try {
    const image = await page.screenshot({ type: 'png', fullPage: false });
    const screenshotDir = join(outputDir, 'state', 'login-screenshots');
    await mkdir(screenshotDir, { recursive: true });

    const fileName = `${timestampForFile()}-${safeStage(stage)}.png`;
    await writeFile(join(screenshotDir, fileName), image);

    const message = `支付宝登录需要处理：${stage}\n截图文件：${fileName}`;
    await sendFeishuText({ ...env, FEISHU_SEND_TO: 'personal' }, message, fetchImpl);

    const imageResult = await sendFeishuPersonalImage(env, image, fetchImpl);
    if (!imageResult.sent) {
      log?.(`支付宝登录截图通知跳过: ${imageResult.reason}`);
      return { notified: false, reason: imageResult.reason };
    }

    return { notified: true, fileName };
  } catch (error) {
    const reason = errorMessage(error);
    log?.(`支付宝登录截图通知失败: ${reason}`);
    return { notified: false, reason };
  }
}
