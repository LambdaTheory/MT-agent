import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDailyMissionAuditSummary } from '../src/cli/dailyMissionAudit.js';

describe('audit summary aggregation', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mt-auds-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('includes approval and execution counts', async () => {
    const missionDir = join(dir, 'daily-mission', '2026-07-02');
    await mkdir(missionDir, { recursive: true });
    await writeFile(join(missionDir, 'approval-request.json'), JSON.stringify({ approvals: [{ decisionId: 'dec-1' }], observations: [{ decisionId: 'o1' }] }), 'utf8');
    await writeFile(join(missionDir, 'execution-results.json'), JSON.stringify([{ runId: 'run-1', decisionId: 'dec-1', ok: true, status: 'executed', text: '' }]), 'utf8');

    const summary = await buildDailyMissionAuditSummary(dir, '2026-07-02');
    const text = summary.lines.join('\n');

    expect(text).toContain('待审批');
    expect(text).toContain('已执行');
  });

  it('lists per-decision execution status', async () => {
    const missionDir = join(dir, 'daily-mission', '2026-07-02');
    await mkdir(missionDir, { recursive: true });
    await writeFile(join(missionDir, 'approval-request.json'), JSON.stringify({
      approvals: [{
        decisionId: 'dec-1',
        recommendation: 'approve_to_execute',
        subjects: [{ kind: 'product', id: '648' }],
      }],
      observations: [],
    }), 'utf8');
    await writeFile(join(missionDir, 'execution-results.json'), JSON.stringify([{ runId: 'run-1', decisionId: 'dec-1', ok: true, status: 'executed', text: '' }]), 'utf8');

    const summary = await buildDailyMissionAuditSummary(dir, '2026-07-02');
    expect(summary.decisions?.find((item: { decisionId: string }) => item.decisionId === 'dec-1')?.status).toBe('executed');
    expect(summary.lines.join('\n')).toContain('dec-1：executed');
  });
});
