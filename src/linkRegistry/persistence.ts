import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const fileQueues = new Map<string, Promise<unknown>>();
const lockRetryMs = 25;
const staleLockMs = 120_000;

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readJsonOrFallback<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return fallback;
    throw error;
  }
}

async function acquireFileLock(path: string): Promise<() => Promise<void>> {
  const lockPath = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true });
  while (true) {
    try {
      await mkdir(lockPath);
      return async () => {
        await rm(lockPath, { recursive: true, force: true });
      };
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
      const lockStat = await stat(lockPath).catch((statError) => {
        if (errorCode(statError) === 'ENOENT') return null;
        throw statError;
      });
      if (lockStat && Date.now() - lockStat.mtimeMs > staleLockMs) {
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }
      await sleep(lockRetryMs);
    }
  }
}

export async function mutateJsonFileSerialized<T>(path: string, fallback: T, mutator: (current: T) => T | Promise<T>): Promise<T> {
  const queueKey = resolve(path);
  const previous = fileQueues.get(queueKey) ?? Promise.resolve();
  const next = previous.then(async () => {
    const release = await acquireFileLock(queueKey);
    try {
      const current = await readJsonOrFallback(queueKey, fallback);
      const updated = await mutator(current);
      await writeJsonAtomic(queueKey, updated);
      return updated;
    } finally {
      await release();
    }
  });
  fileQueues.set(queueKey, next.catch(() => undefined));
  return next;
}
