import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  custodyCleanupPlanConfirmationKey,
  importCustodyPreviewAudit,
  isCustodyCleanupPlanRef,
  loadCustodyCleanupPlan,
  saveCustodyCleanupPlan,
  verifyCustodyCleanupPlanKey,
  type CustodyCleanupPlan,
} from '../src/custodyConflictCleanup/index.js';
import { custodyFixtureCompletedAt, writeCanonicalCustodyPreviewAudit } from './custodyConflictCleanupFixture.js';

const freshNow = new Date('2026-07-31T09:00:00.000Z');

const tempDirs: string[] = [];

interface MutableAuditDocument {
  runId?: string;
  createdAt?: string;
  events?: MutableAuditEvent[];
}

interface MutableAuditEvent {
  type?: string;
  at?: string;
  execute?: boolean;
  pageNumber?: number;
  rowId?: string;
  productName?: string;
  platformProductId?: string;
  productStatusLabel?: string;
  custodyStatusLabel?: string;
  actionLabels?: string[];
  pagesVisited?: number;
  candidatesFound?: number;
  cancelledCount?: number;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'custody-plan-'));
  tempDirs.push(dir);
  return dir;
}

async function readSourceAudit(): Promise<MutableAuditDocument> {
  return JSON.parse(await readFile(await writeCanonicalCustodyPreviewAudit(await tempDir()), 'utf8')) as MutableAuditDocument;
}

async function writeAudit(mutator: (audit: MutableAuditDocument) => void): Promise<string> {
  const dir = await tempDir();
  const audit = await readSourceAudit();
  mutator(audit);
  const path = join(dir, 'audit.json');
  await writeFile(path, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  return path;
}

function candidateEvents(audit: MutableAuditDocument): MutableAuditEvent[] {
  return audit.events?.filter((event) => event.type === 'candidate_previewed') ?? [];
}

function completedEvent(audit: MutableAuditDocument): MutableAuditEvent | undefined {
  return audit.events?.find((event) => event.type === 'run_completed');
}

async function importSourcePlan(): Promise<CustodyCleanupPlan> {
  return importCustodyPreviewAudit(await writeCanonicalCustodyPreviewAudit(await tempDir()), { now: freshNow });
}

async function writeRekeyedPlan(outputDir: string, plan: CustodyCleanupPlan, mutator: (plan: Record<string, unknown>) => void): Promise<void> {
  const path = join(outputDir, 'latest', 'custody-cleanup-plans', `${plan.planRef}.json`);
  const tampered = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  mutator(tampered);
  tampered.confirmationKey = custodyCleanupPlanConfirmationKey(tampered as unknown as CustodyCleanupPlan);
  await writeFile(path, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');
}

describe('custody conflict cleanup plan store', () => {
  it('imports exactly the successful 36-candidate preview audit and binds it to a canonical plan', async () => {
    const fixturePath = await writeCanonicalCustodyPreviewAudit(await tempDir());
    const raw = await readFile(fixturePath);
    const plan = await importCustodyPreviewAudit(fixturePath, { now: freshNow });

    expect(plan.planRef).toMatch(/^custody-cleanup-plan-[a-f0-9]{24}$/);
    expect(isCustodyCleanupPlanRef(plan.planRef)).toBe(true);
    expect(plan.sourceAudit.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.sourceAudit.byteLength).toBe(raw.byteLength);
    expect(plan.importSummary).toEqual({ pagesVisited: 39, candidatesFound: 36, cancelledCount: 0 });
    expect(plan.candidates).toHaveLength(36);
    expect(new Set(plan.candidates.map((candidate) => candidate.platformProductId)).size).toBe(36);
    expect(plan.candidates[0]).toMatchObject({
      rowId: '2026073100216201000000000001',
      platformProductId: '2026073100216201000000000001',
      pageNumber: 1,
    });
    expect(plan.createdAt).toBe(custodyFixtureCompletedAt);
    expect(plan.expiresAt).toBe('2026-07-31T11:23:09.275Z');
    expect(custodyCleanupPlanConfirmationKey(plan)).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyCustodyCleanupPlanKey(plan, custodyCleanupPlanConfirmationKey(plan))).toBe(true);
  });

  it('persists and reloads the canonical plan from latest custody-cleanup-plans', async () => {
    const outputDir = await tempDir();
    const plan = await importSourcePlan();
    const planPath = await saveCustodyCleanupPlan(plan, outputDir);

    expect(planPath).toBe(join(outputDir, 'latest', 'custody-cleanup-plans', `${plan.planRef}.json`));
    const reloaded = await loadCustodyCleanupPlan(outputDir, plan.planRef, { now: freshNow });

    expect(reloaded).toEqual(plan);
    expect(verifyCustodyCleanupPlanKey(reloaded, custodyCleanupPlanConfirmationKey(plan))).toBe(true);
  });

  it('rejects malformed and incomplete audits', async () => {
    const malformedDir = await tempDir();
    const malformedPath = join(malformedDir, 'malformed.json');
    await writeFile(malformedPath, '{not-json', 'utf8');

    await expect(importCustodyPreviewAudit(malformedPath, { now: freshNow })).rejects.toThrow(/valid JSON/i);
    await expect(importCustodyPreviewAudit(await writeAudit((audit) => {
      audit.events = audit.events?.filter((event) => event.type !== 'run_completed');
    }), { now: freshNow })).rejects.toThrow(/run_completed/i);
    await expect(importCustodyPreviewAudit(await writeAudit((audit) => {
      audit.events?.unshift({ type: 'run_started', at: '2026-07-31T07:19:06.702Z', execute: false });
    }), { now: freshNow })).rejects.toThrow(/one run_started/i);
  });

  it('rejects execute=true, mutation evidence, and nonzero writes', async () => {
    await expect(importCustodyPreviewAudit(await writeAudit((audit) => {
      const started = audit.events?.find((event) => event.type === 'run_started');
      if (started) started.execute = true;
    }), { now: freshNow })).rejects.toThrow(/execute:false/i);
    await expect(importCustodyPreviewAudit(await writeAudit((audit) => {
      audit.events?.splice(2, 0, { type: 'cancel_requested', at: '2026-07-31T07:19:40.000Z', pageNumber: 1, rowId: 'x', productName: 'x' });
    }), { now: freshNow })).rejects.toThrow(/mutation/i);
    await expect(importCustodyPreviewAudit(await writeAudit((audit) => {
      const completed = completedEvent(audit);
      if (completed) completed.cancelledCount = 1;
    }), { now: freshNow })).rejects.toThrow(/cancelledCount:0/i);
    await expect(importCustodyPreviewAudit(await writeAudit((audit) => {
      audit.events?.splice(-1, 0, { type: 'run_failed', at: '2026-07-31T07:23:00.000Z' });
    }), { now: freshNow })).rejects.toThrow(/run_failed/i);
  });

  it('rejects page_scanned coverage that does not visit each page 1..39 exactly once', async () => {
    await expect(importCustodyPreviewAudit(await writeAudit((audit) => {
      const pageTwo = audit.events?.find((event) => event.type === 'page_scanned' && event.pageNumber === 2);
      if (pageTwo) pageTwo.pageNumber = 1;
    }), { now: freshNow })).rejects.toThrow(/page_scanned|1\.\.39/i);
  });

  it('rejects count mismatches, duplicate IDs, and missing platform product IDs', async () => {
    await expect(importCustodyPreviewAudit(await writeAudit((audit) => {
      const completed = completedEvent(audit);
      if (completed) completed.candidatesFound = 35;
    }), { now: freshNow })).rejects.toThrow(/candidate_previewed count|candidatesFound/i);
    await expect(importCustodyPreviewAudit(await writeAudit((audit) => {
      const candidates = candidateEvents(audit);
      if (candidates[1] && candidates[0]?.platformProductId) candidates[1].platformProductId = candidates[0].platformProductId;
    }), { now: freshNow })).rejects.toThrow(/duplicate/i);
    await expect(importCustodyPreviewAudit(await writeAudit((audit) => {
      delete candidateEvents(audit)[0]?.platformProductId;
    }), { now: freshNow })).rejects.toThrow(/platform product id/i);
  });

  it('rejects candidates without strict conflict semantics, product-like platform IDs, page bounds, and allowed actions', async () => {
    await expect(importCustodyPreviewAudit(await writeAudit((audit) => {
      const candidate = candidateEvents(audit)[0];
      if (candidate) candidate.productStatusLabel = '出售中';
    }), { now: freshNow })).rejects.toThrow(/productStatusLabel|candidate/i);
    await expect(importCustodyPreviewAudit(await writeAudit((audit) => {
      const candidate = candidateEvents(audit)[0];
      if (candidate) candidate.custodyStatusLabel = '托管中';
    }), { now: freshNow })).rejects.toThrow(/custodyStatusLabel|candidate/i);
    await expect(importCustodyPreviewAudit(await writeAudit((audit) => {
      const candidate = candidateEvents(audit)[0];
      if (candidate) candidate.platformProductId = 'not-a-product-id';
    }), { now: freshNow })).rejects.toThrow(/platform product id/i);
    await expect(importCustodyPreviewAudit(await writeAudit((audit) => {
      const candidate = candidateEvents(audit)[0];
      if (candidate) candidate.pageNumber = 40;
    }), { now: freshNow })).rejects.toThrow(/pageNumber|1\.\.39/i);
    await expect(importCustodyPreviewAudit(await writeAudit((audit) => {
      const candidate = candidateEvents(audit)[0];
      if (candidate) candidate.actionLabels = ['数据'];
    }), { now: freshNow })).rejects.toThrow(/allowed action/i);
  });

  it('rejects stale audits by run_completed.at using the default four-hour TTL', async () => {
    const fixturePath = await writeCanonicalCustodyPreviewAudit(await tempDir());
    await expect(importCustodyPreviewAudit(fixturePath, { now: new Date('2026-07-31T11:23:47.000Z') })).rejects.toThrow(/expired|stale/i);
    await expect(importCustodyPreviewAudit(fixturePath, { now: new Date('2026-07-31T11:23:09.275Z') })).rejects.toThrow(/expired|stale/i);
  });

  it('changes plan identity and confirmation key when raw audit bytes change', async () => {
    const original = await importSourcePlan();
    const changedPath = await writeAudit((audit) => {
      const candidates = candidateEvents(audit);
      if (candidates[0]) candidates[0].productName = `${candidates[0].productName} changed`;
    });

    const changed = await importCustodyPreviewAudit(changedPath, { now: freshNow });

    expect(changed.sourceAudit.sha256).not.toBe(original.sourceAudit.sha256);
    expect(changed.planRef).not.toBe(original.planRef);
    expect(custodyCleanupPlanConfirmationKey(changed)).not.toBe(custodyCleanupPlanConfirmationKey(original));
  });

  it('accepts a fresh preview with a different positive candidate count when the audit is internally consistent', async () => {
    const plan = await importCustodyPreviewAudit(await writeCanonicalCustodyPreviewAudit(await tempDir(), 45), { now: freshNow });

    expect(plan.importSummary).toEqual({ pagesVisited: 39, candidatesFound: 45, cancelledCount: 0 });
    expect(plan.candidates).toHaveLength(45);
  });

  it('rejects wrong confirmation keys and tampered persisted files', async () => {
    const outputDir = await tempDir();
    const plan = await importSourcePlan();
    const planPath = await saveCustodyCleanupPlan(plan, outputDir);

    expect(verifyCustodyCleanupPlanKey(plan, '0'.repeat(64))).toBe(false);

    const tampered = JSON.parse(await readFile(planPath, 'utf8')) as { candidates: unknown[] };
    tampered.candidates = tampered.candidates.slice(1);
    await writeFile(planPath, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');

    await expect(loadCustodyCleanupPlan(outputDir, plan.planRef, { now: freshNow })).rejects.toThrow(/tamper|confirmation key|canonical|candidate count/i);
  });

  it('rejects persisted plans with recomputed keys but invalid candidate semantics or exact expiry', async () => {
    const outputDir = await tempDir();
    const plan = await importSourcePlan();
    await saveCustodyCleanupPlan(plan, outputDir);

    await writeRekeyedPlan(outputDir, plan, (tampered) => {
      const candidates = tampered.candidates as Array<Record<string, unknown>>;
      candidates[0].productStatusLabel = '出售中';
    });

    await expect(loadCustodyCleanupPlan(outputDir, plan.planRef, { now: freshNow })).rejects.toThrow(/candidate|productStatusLabel/i);

    await saveCustodyCleanupPlan(plan, outputDir);
    await expect(loadCustodyCleanupPlan(outputDir, plan.planRef, { now: new Date(plan.expiresAt) })).rejects.toThrow(/expired|stale/i);
  });
});
