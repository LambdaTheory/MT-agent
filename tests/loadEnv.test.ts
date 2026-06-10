import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/loadEnv.js';

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'mt-env-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('loadEnv', () => {
  it('loads variables from env file', async () => {
    await withTempDir(async (dir) => {
      const env: Record<string, string | undefined> = {};
      const path = join(dir, '.env');
      await writeFile(path, 'FEISHU_APP_ID=cli_test\nFEISHU_RECEIVE_ID_TYPE=open_id\n', 'utf8');

      await loadEnv(path, env);

      expect(env.FEISHU_APP_ID).toBe('cli_test');
      expect(env.FEISHU_RECEIVE_ID_TYPE).toBe('open_id');
    });
  });

  it('does not override existing variables', async () => {
    await withTempDir(async (dir) => {
      const env: Record<string, string | undefined> = { FEISHU_APP_ID: 'from-shell' };
      const path = join(dir, '.env');
      await writeFile(path, 'FEISHU_APP_ID=from-file\n', 'utf8');

      await loadEnv(path, env);

      expect(env.FEISHU_APP_ID).toBe('from-shell');
    });
  });

  it('ignores comments blank lines and invalid lines, and strips simple quotes', async () => {
    await withTempDir(async (dir) => {
      const env: Record<string, string | undefined> = {};
      const path = join(dir, '.env');
      await writeFile(path, '# comment\n\nINVALID_LINE\nFEISHU_APP_SECRET="secret value"\nFEISHU_RECEIVE_ID=\'ou_test\'\n', 'utf8');

      await loadEnv(path, env);

      expect(env.INVALID_LINE).toBeUndefined();
      expect(env.FEISHU_APP_SECRET).toBe('secret value');
      expect(env.FEISHU_RECEIVE_ID).toBe('ou_test');
    });
  });

  it('does not fail when env file is missing', async () => {
    await withTempDir(async (dir) => {
      const env: Record<string, string | undefined> = {};
      await expect(loadEnv(join(dir, '.env'), env)).resolves.toBeUndefined();
      expect(env).toEqual({});
    });
  });
});
