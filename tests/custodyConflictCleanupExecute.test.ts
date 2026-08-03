import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';
import {
  JsonCustodyConflictAuditWriter,
  custodyCleanupPlanConfirmationKey,
  executeCustodyCleanupPlan,
  importCustodyPreviewAudit,
  saveCustodyCleanupPlan,
  type CustodyConflictCleanupAdapter,
  type CustodyConflictRow,
  type CustodyConflictTableSnapshot,
} from '../src/custodyConflictCleanup/index.js';
import type { AgentConfig } from '../src/domain/types.js';
import { writeCanonicalCustodyPreviewAudit } from './custodyConflictCleanupFixture.js';

const freshNow = new Date('2026-07-31T09:00:00.000Z');
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'custody-execute-'));
  tempDirs.push(dir);
  return dir;
}

function config(outputDir: string): AgentConfig {
  return {
    targetUrl: 'https://example.invalid/dashboard',
    periods: ['1d'],
    preferredPageSize: 20,
    outputDir,
    browserProfileDir: join(outputDir, 'profile'),
    exposureUrl: 'https://example.invalid/custody',
  };
}

class FakeExecuteAdapter implements CustodyConflictCleanupAdapter {
  readonly cancelled: string[] = [];
  private rows: CustodyConflictRow[];

  constructor(rows: CustodyConflictRow[]) {
    this.rows = rows;
  }

  async openCustodyPage(): Promise<void> {}

  async readCurrentPage(): Promise<CustodyConflictTableSnapshot> {
    return this.snapshot();
  }

  async goToPage(): Promise<CustodyConflictTableSnapshot> {
    return this.snapshot();
  }

  async cancelCustody(row: CustodyConflictRow): Promise<{ confirmed: boolean; confirmationLabel: string }> {
    this.cancelled.push(row.platformProductId ?? row.rowId);
    this.rows = this.rows.filter((candidate) => candidate.rowId !== row.rowId && candidate.platformProductId !== row.platformProductId);
    return { confirmed: true, confirmationLabel: '确定' };
  }

  private snapshot(): CustodyConflictTableSnapshot {
    return {
      pageNumber: 1,
      totalPages: 1,
      rows: this.rows,
      signature: this.rows.map((row) => row.platformProductId ?? row.rowId).join('|'),
    };
  }
}

describe('custody conflict cleanup confirmed execution', () => {
  it('rejects bad confirmation keys before opening a browser session', async () => {
    const outputDir = await tempDir();
    const plan = await importCustodyPreviewAudit(await writeCanonicalCustodyPreviewAudit(await tempDir()), { now: freshNow });
    await saveCustodyCleanupPlan(plan, outputDir);
    let sessionOpened = false;

    const response = await executeCustodyCleanupPlan({
      config: config(outputDir),
      planRef: plan.planRef,
      confirmationKey: '0'.repeat(64),
      now: freshNow,
      sessionFactory: async () => {
        sessionOpened = true;
        return { browser: { close: async () => {} }, page: {} as Page };
      },
    });

    expect(response.metadata?.ok).toBe(false);
    expect(sessionOpened).toBe(false);
  });

  it('executes only approved plan candidates and blocks duplicate execution claims', async () => {
    const outputDir = await tempDir();
    const plan = await importCustodyPreviewAudit(await writeCanonicalCustodyPreviewAudit(await tempDir()), { now: freshNow });
    await saveCustodyCleanupPlan(plan, outputDir);
    const plannedRows: CustodyConflictRow[] = plan.candidates.map((candidate, index) => ({
      rowId: candidate.rowId,
      rowIndex: index,
      productName: candidate.productName,
      platformProductId: candidate.platformProductId,
      productStatusLabel: candidate.productStatusLabel,
      custodyStatusLabel: candidate.custodyStatusLabel,
      actionLabels: [...candidate.actionLabels],
    }));
    const unplannedRow: CustodyConflictRow = {
      rowId: 'unplanned-row',
      rowIndex: plannedRows.length,
      productName: '未审批商品',
      platformProductId: '209999999999999999999999',
      productStatusLabel: '已下架',
      custodyStatusLabel: '已托管',
      actionLabels: ['取消托管'],
    };
    const adapter = new FakeExecuteAdapter([...plannedRows, unplannedRow]);

    const response = await executeCustodyCleanupPlan({
      config: config(outputDir),
      planRef: plan.planRef,
      confirmationKey: custodyCleanupPlanConfirmationKey(plan),
      now: freshNow,
      sessionFactory: async () => ({ browser: { close: async () => {} }, page: {} as Page }),
      adapterFactory: () => adapter,
      auditWriterFactory: (dir) => JsonCustodyConflictAuditWriter.create(dir, '2026-07-31T10-00-00-000Z'),
    });

    expect(response).toMatchObject({ metadata: { ok: true } });
    expect(adapter.cancelled).toHaveLength(36);
    expect(adapter.cancelled).not.toContain(unplannedRow.platformProductId);

    const duplicate = await executeCustodyCleanupPlan({
      config: config(outputDir),
      planRef: plan.planRef,
      confirmationKey: custodyCleanupPlanConfirmationKey(plan),
      now: freshNow,
      sessionFactory: async () => ({ browser: { close: async () => {} }, page: {} as Page }),
      adapterFactory: () => adapter,
    });
    expect(duplicate.text).toMatch(/已执行或处理中/);
    expect(duplicate.metadata?.ok).toBe(false);
  });
});
