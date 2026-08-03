import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  JsonCustodyConflictAuditWriter,
  isCustodyConflictCandidate,
  runCustodyConflictCleanup,
  type CustodyConflictCleanupAdapter,
  type CustodyConflictRow,
  type CustodyConflictTableSnapshot,
} from '../src/custodyConflictCleanup/index.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function conflictRow(rowId: string, rowIndex: number, actionLabels = ['取消托管']): CustodyConflictRow {
  return {
    rowId,
    rowIndex,
    productName: `商品 ${rowId}`,
    platformProductId: `20${rowId.padStart(22, '0')}`,
    productStatusLabel: '已下架',
    custodyStatusLabel: '已托管',
    actionLabels,
  };
}

function nonConflictRow(rowId: string, rowIndex: number, productStatusLabel: string, custodyStatusLabel: string): CustodyConflictRow {
  return {
    rowId,
    rowIndex,
    productName: `商品 ${rowId}`,
    productStatusLabel,
    custodyStatusLabel,
    actionLabels: ['取消托管'],
  };
}

class FakeCustodyConflictAdapter implements CustodyConflictCleanupAdapter {
  readonly calls: string[] = [];
  private currentPage = 1;

  constructor(
    private pages: CustodyConflictRow[][],
    private readonly unverifiableRowIds = new Set<string>(),
    private readonly readbackFailuresBeforeSuccess = 0,
  ) {}

  async openCustodyPage(): Promise<void> {
    this.calls.push('open');
    this.currentPage = 1;
  }

  async readCurrentPage(): Promise<CustodyConflictTableSnapshot> {
    this.calls.push(`read:${this.currentPage}`);
    return this.snapshot();
  }

  async goToPage(pageNumber: number): Promise<CustodyConflictTableSnapshot> {
    this.currentPage = Math.max(1, Math.min(pageNumber, Math.max(1, this.pages.length)));
    this.calls.push(`goto:${pageNumber}->${this.currentPage}`);
    return this.snapshot();
  }

  async cancelCustody(row: CustodyConflictRow, actionLabel: string): Promise<{ confirmed: boolean; confirmationLabel: string }> {
    this.calls.push(`cancel:${this.currentPage}:${row.rowId}:${actionLabel}`);
    const priorAttempts = this.calls.filter((call) => call === `cancel:${this.currentPage}:${row.rowId}:${actionLabel}`).length - 1;
    if (this.unverifiableRowIds.has(row.rowId) || priorAttempts < this.readbackFailuresBeforeSuccess) {
      this.currentPage = 1;
      return { confirmed: true, confirmationLabel: '确定' };
    }

    this.pages = this.pages
      .map((rows) => rows.filter((candidate) => candidate.rowId !== row.rowId))
      .filter((rows) => rows.length > 0);
    this.currentPage = 1;
    return { confirmed: true, confirmationLabel: '确定' };
  }

  private snapshot(): CustodyConflictTableSnapshot {
    const rows = this.pages[this.currentPage - 1] ?? [];
    return {
      pageNumber: this.currentPage,
      totalPages: Math.max(1, this.pages.length),
      rows,
      signature: rows.map((row) => row.rowId).join('|'),
    };
  }
}

class ThrowingCustodyConflictAdapter implements CustodyConflictCleanupAdapter {
  async openCustodyPage(): Promise<void> {}

  async readCurrentPage(): Promise<CustodyConflictTableSnapshot> {
    throw new Error('adapter read failed');
  }

  async goToPage(): Promise<CustodyConflictTableSnapshot> {
    throw new Error('adapter navigation failed');
  }

  async cancelCustody(): Promise<{ confirmed: boolean; confirmationLabel: string }> {
    throw new Error('cancel should not run');
  }
}

class ShrinkingLastPageAdapter implements CustodyConflictCleanupAdapter {
  readonly calls: string[] = [];
  private currentPage = 1;
  private firstCancelled = false;
  private secondCancelled = false;

  async openCustodyPage(): Promise<void> {
    this.calls.push('open');
  }

  async readCurrentPage(): Promise<CustodyConflictTableSnapshot> {
    this.calls.push(`read:${this.currentPage}`);
    return this.snapshot();
  }

  async goToPage(pageNumber: number): Promise<CustodyConflictTableSnapshot> {
    const totalPages = this.secondCancelled ? 1 : this.firstCancelled ? 2 : 3;
    this.currentPage = Math.max(1, Math.min(pageNumber, totalPages));
    this.calls.push(`goto:${pageNumber}->${this.currentPage}`);
    return this.snapshot();
  }

  async cancelCustody(row: CustodyConflictRow, actionLabel: string): Promise<{ confirmed: boolean; confirmationLabel: string }> {
    this.calls.push(`cancel:${this.currentPage}:${row.rowId}:${actionLabel}`);
    if (row.rowId === '3') this.firstCancelled = true;
    if (row.rowId === '4') this.secondCancelled = true;
    this.currentPage = 1;
    return { confirmed: true, confirmationLabel: '确定' };
  }

  private snapshot(): CustodyConflictTableSnapshot {
    if (this.secondCancelled) {
      return { pageNumber: this.currentPage, totalPages: 1, rows: [nonConflictRow('1', 0, '出售中', '已托管')], signature: 'p1' };
    }
    if (this.firstCancelled) {
      const rows = this.currentPage === 2
        ? [conflictRow('4', 0)]
        : [nonConflictRow('1', 0, '出售中', '已托管')];
      return { pageNumber: this.currentPage, totalPages: 2, rows, signature: rows.map((row) => row.rowId).join('|') };
    }
    const rows = this.currentPage === 3
      ? [conflictRow('3', 0)]
      : [nonConflictRow(String(this.currentPage), 0, '出售中', '已托管')];
    return { pageNumber: this.currentPage, totalPages: 3, rows, signature: rows.map((row) => row.rowId).join('|') };
  }
}

class ReadbackThrowingAfterWriteAdapter implements CustodyConflictCleanupAdapter {
  readonly calls: string[] = [];
  private currentPage = 1;
  private writeConfirmed = false;

  async openCustodyPage(): Promise<void> {
    this.calls.push('open');
  }

  async readCurrentPage(): Promise<CustodyConflictTableSnapshot> {
    this.calls.push(`read:${this.currentPage}`);
    return this.snapshot();
  }

  async goToPage(pageNumber: number): Promise<CustodyConflictTableSnapshot> {
    this.calls.push(`goto:${pageNumber}`);
    if (this.writeConfirmed) throw new Error(`readback navigation failed for page ${pageNumber}`);
    this.currentPage = pageNumber;
    return this.snapshot();
  }

  async cancelCustody(row: CustodyConflictRow, actionLabel: string): Promise<{ confirmed: boolean; confirmationLabel: string }> {
    this.calls.push(`cancel:${this.currentPage}:${row.rowId}:${actionLabel}`);
    this.writeConfirmed = true;
    this.currentPage = 1;
    return { confirmed: true, confirmationLabel: '确定' };
  }

  private snapshot(): CustodyConflictTableSnapshot {
    return { pageNumber: this.currentPage, totalPages: 1, rows: [conflictRow('1', 0)], signature: '1' };
  }
}

async function createAuditWriter(): Promise<JsonCustodyConflictAuditWriter> {
  const dir = await mkdtemp(join(tmpdir(), 'custody-conflict-audit-'));
  tempDirs.push(dir);
  return JsonCustodyConflictAuditWriter.create(dir, '2026-07-31T00-00-00-000Z');
}

describe('custody conflict cleanup workflow', () => {
  it('matches only exact candidate labels in the strict model', () => {
    expect(isCustodyConflictCandidate(conflictRow('1', 0))).toBe(true);
    expect(isCustodyConflictCandidate({ ...conflictRow('2', 0), custodyStatusLabel: '已托管 12 天' })).toBe(true);
    expect(isCustodyConflictCandidate({ ...conflictRow('3', 0), custodyStatusLabel: '已托管12天' })).toBe(true);
    expect(isCustodyConflictCandidate({ ...conflictRow('8', 0), custodyStatusLabel: '托管中 已托管 2天' })).toBe(true);
    expect(isCustodyConflictCandidate({ ...conflictRow('9', 0), custodyStatusLabel: '托管中 已托管 10天' })).toBe(true);
    expect(isCustodyConflictCandidate({ ...conflictRow('10', 0), custodyStatusLabel: '托管异常 已托管 10天' })).toBe(true);
    expect(isCustodyConflictCandidate(nonConflictRow('2', 0, '已下架中', '已托管'))).toBe(false);
    expect(isCustodyConflictCandidate(nonConflictRow('3', 0, '已下架', '托管中'))).toBe(false);
    expect(isCustodyConflictCandidate(nonConflictRow('4', 0, '出售中 已下架', '已托管'))).toBe(false);
    expect(isCustodyConflictCandidate(nonConflictRow('5', 0, '已下架', '未托管'))).toBe(false);
    expect(isCustodyConflictCandidate(nonConflictRow('6', 0, '已下架', '已托管中'))).toBe(false);
    expect(isCustodyConflictCandidate(nonConflictRow('7', 0, '已下架', '当前已托管'))).toBe(false);
  });

  it('previews only rows with explicit delisted product status and explicit custody status', async () => {
    const adapter = new FakeCustodyConflictAdapter([[
      conflictRow('1', 0),
      nonConflictRow('2', 1, '出售中', '已托管'),
      nonConflictRow('3', 2, '已下架', '未托管'),
      nonConflictRow('4', 3, '已下架(待确认)', '已托管'),
    ]]);
    const auditWriter = await createAuditWriter();

    const result = await runCustodyConflictCleanup({ adapter, auditWriter, execute: false });

    expect(result.previewOnly).toBe(true);
    expect(result.candidatesFound).toBe(1);
    expect(result.cancelledCount).toBe(0);
    expect(adapter.calls).not.toContain('cancel:1:1:取消托管');
  });

  it('counts unique candidates instead of double-counting rows that remain across sweeps', async () => {
    const adapter = new FakeCustodyConflictAdapter([[conflictRow('1', 0), conflictRow('2', 1)]], new Set(['1']));
    const auditWriter = await createAuditWriter();

    await expect(runCustodyConflictCleanup({ adapter, auditWriter, execute: true, maxReadbackAttempts: 2 })).rejects.toThrow(/readback verification/i);

    const audit = JSON.parse(await readFile(auditWriter.path, 'utf8')) as { events: Array<{ type: string; rowId?: string }> };
    const previews = audit.events.filter((event) => event.type === 'candidate_previewed');
    expect(previews.map((event) => event.rowId).sort()).toEqual(['1', '2']);
  });

  it('cancels serially, returns to the remembered page after page-1 redirects, and keeps cleaning that page', async () => {
    const adapter = new FakeCustodyConflictAdapter([
      [nonConflictRow('1', 0, '出售中', '已托管')],
      [conflictRow('2', 0), conflictRow('3', 1)],
      [conflictRow('4', 0, ['解除托管'])],
    ]);
    const auditWriter = await createAuditWriter();

    const result = await runCustodyConflictCleanup({ adapter, auditWriter, execute: true });

    expect(result.cancelledCount).toBe(3);
    expect(adapter.calls).toEqual(expect.arrayContaining([
      'goto:2->2',
      'cancel:2:2:取消托管',
      'goto:2->2',
      'cancel:2:3:取消托管',
      'goto:2->2',
      'cancel:2:4:解除托管',
    ]));
    expect(adapter.calls.filter((call) => call.startsWith('cancel:'))).toEqual([
      'cancel:2:2:取消托管',
      'cancel:2:3:取消托管',
      'cancel:2:4:解除托管',
    ]);
  });

  it('recovers to the new last page after page-count shrink and keeps cleaning shifted conflicts', async () => {
    const adapter = new ShrinkingLastPageAdapter();
    const auditWriter = await createAuditWriter();

    const result = await runCustodyConflictCleanup({ adapter, auditWriter, execute: true });

    expect(result.cancelledCount).toBe(2);
    expect(adapter.calls).toEqual(expect.arrayContaining([
      'goto:3->3',
      'cancel:3:3:取消托管',
      'goto:3->2',
      'cancel:2:4:取消托管',
    ]));
    expect(adapter.calls.filter((call) => call.startsWith('cancel:'))).toEqual([
      'cancel:3:3:取消托管',
      'cancel:2:4:取消托管',
    ]);
  });

  it('fails closed when a conflicting row has no visible allowed cancel action', async () => {
    const adapter = new FakeCustodyConflictAdapter([[conflictRow('1', 0, ['编辑', '查看'])]]);
    const auditWriter = await createAuditWriter();

    await expect(runCustodyConflictCleanup({ adapter, auditWriter, execute: true })).rejects.toThrow(/allowed cancel action/i);
    const audit = JSON.parse(await readFile(auditWriter.path, 'utf8')) as { events: Array<{ type: string; reason?: string }> };
    expect(audit.events.filter((event) => event.type === 'run_failed')).toHaveLength(1);
    expect(audit.events.find((event) => event.type === 'run_failed')?.reason).toMatch(/allowed cancel action/i);
    expect(adapter.calls.filter((call) => call.startsWith('cancel:'))).toEqual([]);
  });

  it('stops after an unverifiable confirmed write and persists partial audit evidence', async () => {
    const adapter = new FakeCustodyConflictAdapter([[conflictRow('1', 0), conflictRow('2', 1)]], new Set(['1']));
    const auditWriter = await createAuditWriter();

    await expect(runCustodyConflictCleanup({ adapter, auditWriter, execute: true })).rejects.toThrow(/readback verification/i);

    const audit = JSON.parse(await readFile(auditWriter.path, 'utf8')) as { events: Array<{ type: string; rowId?: string }> };
    expect(audit.events.map((event) => event.type)).toContain('cancel_confirmed');
    expect(audit.events.map((event) => event.type)).toContain('write_unverified');
    expect(audit.events.map((event) => event.type)).toContain('run_failed');
    expect(audit.events.filter((event) => event.type === 'run_failed')).toHaveLength(1);
    expect(adapter.calls.filter((call) => call.startsWith('cancel:'))).toEqual(['cancel:1:1:取消托管']);
  });

  it('records write_unverified after bounded readback navigation errors and does not issue a second cancellation', async () => {
    const adapter = new ReadbackThrowingAfterWriteAdapter();
    const auditWriter = await createAuditWriter();

    await expect(runCustodyConflictCleanup({ adapter, auditWriter, execute: true, maxReadbackAttempts: 3 })).rejects.toThrow(/readback verification/i);

    const audit = JSON.parse(await readFile(auditWriter.path, 'utf8')) as { events: Array<{ type: string; reason?: string }> };
    const writeUnverified = audit.events.filter((event) => event.type === 'write_unverified');
    expect(writeUnverified).toHaveLength(1);
    expect(writeUnverified[0]?.reason).toMatch(/readback navigation failed for page 1/i);
    expect(audit.events.filter((event) => event.type === 'run_failed')).toHaveLength(1);
    expect(adapter.calls.filter((call) => call.startsWith('cancel:'))).toEqual(['cancel:1:1:取消托管']);
    expect(adapter.calls.filter((call) => call === 'goto:1')).toHaveLength(4);
  });

  it('retries bounded readback before failing a confirmed write', async () => {
    const adapter = new FakeCustodyConflictAdapter([[conflictRow('1', 0)]], new Set(['1']));
    const auditWriter = await createAuditWriter();

    await expect(runCustodyConflictCleanup({ adapter, auditWriter, execute: true, maxReadbackAttempts: 3 })).rejects.toThrow(/readback verification/i);

    expect(adapter.calls.filter((call) => call === 'goto:1->1').length).toBeGreaterThanOrEqual(4);
  });

  it('does not silently complete when page limits stop before remaining pages', async () => {
    const adapter = new FakeCustodyConflictAdapter([
      [nonConflictRow('1', 0, '出售中', '已托管')],
      [nonConflictRow('2', 0, '出售中', '已托管')],
    ]);
    const auditWriter = await createAuditWriter();

    await expect(runCustodyConflictCleanup({ adapter, auditWriter, execute: false, maxPages: 1 })).rejects.toThrow(/page limit/i);
    const audit = JSON.parse(await readFile(auditWriter.path, 'utf8')) as { events: Array<{ type: string }> };
    expect(audit.events.filter((event) => event.type === 'run_failed')).toHaveLength(1);
  });

  it('records terminal adapter/navigation failures in audit without duplicate failure events', async () => {
    const auditWriter = await createAuditWriter();

    await expect(runCustodyConflictCleanup({ adapter: new ThrowingCustodyConflictAdapter(), auditWriter, execute: true })).rejects.toThrow(/adapter navigation failed/i);

    const audit = JSON.parse(await readFile(auditWriter.path, 'utf8')) as { events: Array<{ type: string; reason?: string }> };
    expect(audit.events.filter((event) => event.type === 'run_failed')).toHaveLength(1);
    expect(audit.events.find((event) => event.type === 'run_failed')?.reason).toMatch(/adapter navigation failed/i);
  });
});
