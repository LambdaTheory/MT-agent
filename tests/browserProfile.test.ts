import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearBrowserProfileLocks, prepareDashboardPage } from '../src/crawler/browserProfile.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mt-agent-profile-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('clearBrowserProfileLocks', () => {
  it('removes chromium singleton lock artifacts but keeps other profile files', async () => {
    const profileDir = await makeTempDir();
    await writeFile(join(profileDir, 'SingletonLock'), 'lock', 'utf8');
    await writeFile(join(profileDir, 'SingletonCookie'), 'cookie', 'utf8');
    await mkdir(join(profileDir, 'SingletonSocket'));
    await writeFile(join(profileDir, 'Preferences'), 'keep', 'utf8');

    await clearBrowserProfileLocks(profileDir);

    await expect(readFile(join(profileDir, 'SingletonLock'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(profileDir, 'SingletonCookie'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(profileDir, 'SingletonSocket'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(profileDir, 'Preferences'), 'utf8')).resolves.toBe('keep');
  });
});

describe('prepareDashboardPage', () => {
  it('keeps one usable page and closes extra blank pages', async () => {
    const pages = [fakePage('about:blank'), fakePage('about:blank'), fakePage('https://example.com/dashboard')];

    const selected = await prepareDashboardPage(pages, async () => fakePage('about:blank'));

    expect(selected).toBe(pages[2]);
    expect(pages[0].closed).toBe(true);
    expect(pages[1].closed).toBe(true);
    expect(pages[2].closed).toBe(false);
  });
});

function fakePage(url: string): { closed: boolean; url: () => string; close: () => Promise<void> } {
  return {
    closed: false,
    url: () => url,
    close: async function close() {
      this.closed = true;
    },
  };
}
