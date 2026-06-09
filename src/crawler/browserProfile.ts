import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';

const CHROMIUM_LOCK_ARTIFACTS = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];

export async function clearBrowserProfileLocks(profileDir: string): Promise<void> {
  await Promise.all(
    CHROMIUM_LOCK_ARTIFACTS.map((name) => rm(join(profileDir, name), { recursive: true, force: true })),
  );
}

type PageLike = Pick<Page, 'url' | 'close'>;

export async function prepareDashboardPage<T extends PageLike>(pages: T[], createPage: () => Promise<T>): Promise<T> {
  const selected = pages.find((page) => page.url() !== 'about:blank') ?? pages[0] ?? (await createPage());
  await Promise.all(pages.filter((page) => page !== selected && page.url() === 'about:blank').map((page) => page.close()));
  return selected;
}
