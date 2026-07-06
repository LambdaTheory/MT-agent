import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { mutateJsonFileSerialized, writeJsonAtomic } from '../src/linkRegistry/persistence.js';

const execFileAsync = promisify(execFile);
const processRunner = process.platform === 'win32'
  ? { command: 'cmd.exe', baseArgs: ['/c', 'npx', 'tsx'] }
  : { command: 'npx', baseArgs: ['tsx'] };

describe('linkRegistry persistence', () => {
  it('writes JSON atomically with stable formatting', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'link-registry-persistence-'));
    const file = join(dir, 'state.json');

    await writeJsonAtomic(file, { version: 1, entries: [{ id: '1' }] });

    const content = await readFile(file, 'utf8');
    expect(content).toContain('"version": 1');
    expect(content.endsWith('\n')).toBe(true);
  });

  it('serializes mutations on one target file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'link-registry-persistence-'));
    const file = join(dir, 'counter.json');

    await Promise.all([
      mutateJsonFileSerialized(file, { count: 0 }, (current) => ({ count: current.count + 1 })),
      mutateJsonFileSerialized(file, { count: 0 }, (current) => ({ count: current.count + 1 })),
    ]);

    const parsed = JSON.parse(await readFile(file, 'utf8')) as { count: number };
    expect(parsed.count).toBe(2);
  });

  it('serializes mutations from separate node processes on one target file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'link-registry-persistence-'));
    const file = join(dir, 'counter.json');
    const worker = join(dir, 'mutate-worker.ts');
    const persistenceModule = pathToFileURL(join(process.cwd(), 'src', 'linkRegistry', 'persistence.ts')).href;

    await writeFile(worker, [
      `import { mutateJsonFileSerialized } from '${persistenceModule}';`,
      "async function main() {",
      "  const file = process.env.TARGET_FILE;",
      "  const label = process.env.MUTATION_LABEL;",
      "  if (!file || !label) throw new Error('missing worker env');",
      "  await mutateJsonFileSerialized(file, { labels: [] as string[] }, async (current) => {",
      "    await new Promise((resolve) => setTimeout(resolve, 50));",
      "    return { labels: [...current.labels, label] };",
      "  });",
      "}",
      "main().catch((error) => { console.error(error); process.exitCode = 1; });",
    ].join('\n'), 'utf8');

    await Promise.all(['first', 'second'].map((label) => execFileAsync(processRunner.command, [...processRunner.baseArgs, worker], {
      env: { ...process.env, TARGET_FILE: file, MUTATION_LABEL: label },
      cwd: process.cwd(),
    })));

    const parsed = JSON.parse(await readFile(file, 'utf8')) as { labels: string[] };
    expect(parsed.labels.sort()).toEqual(['first', 'second']);
  }, 15_000);
});
