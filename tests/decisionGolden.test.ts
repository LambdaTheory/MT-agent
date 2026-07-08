import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RuleBasedDecisionBuilder } from '../src/agentRuntime/decisionBuilder.js';
import { evaluateDecisionGolden } from '../src/agentRuntime/decisionGolden.js';

const goldenDir = join(dirname(fileURLToPath(import.meta.url)), 'nl-decision-golden');

describe('decision golden set', () => {
  it('rule-based builder passes all golden cases', async () => {
    const files = (await readdir(goldenDir)).filter((file) => file.endsWith('.json'));
    const cases = await Promise.all(files.map(async (file) => JSON.parse(await readFile(join(goldenDir, file), 'utf8'))));
    const result = await evaluateDecisionGolden(new RuleBasedDecisionBuilder(), cases);
    expect(result.failed).toEqual([]);
  });
});
