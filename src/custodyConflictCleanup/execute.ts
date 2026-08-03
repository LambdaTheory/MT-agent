import { mkdir, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import { ensureAuthenticatedMerchantSession } from '../crawler/merchantSession.js';
import type { AgentConfig } from '../domain/types.js';
import type { BotResponse } from '../feishuBot/types.js';
import { JsonCustodyConflictAuditWriter } from './audit.js';
import { PlaywrightCustodyConflictAdapter } from './domAdapter.js';
import type {
  CustodyCleanupPlan,
  CustodyCleanupPlanCandidate,
  CustodyConflictCleanupAdapter,
  CustodyConflictRow,
  CustodyConflictTableSnapshot,
} from './models.js';
import { isCustodyCleanupPlanRef, loadCustodyCleanupPlan, verifyCustodyCleanupPlanKey } from './planStore.js';
import { runCustodyConflictCleanup } from './workflow.js';

export interface CustodyCleanupExecuteInput {
  readonly config: AgentConfig;
  readonly planRef: string;
  readonly confirmationKey: string;
  readonly now?: Date;
  readonly sessionFactory?: (config: AgentConfig) => Promise<CustodyCleanupBrowserSession>;
  readonly adapterFactory?: (page: Page, config: AgentConfig) => CustodyConflictCleanupAdapter;
  readonly auditWriterFactory?: (outputDir: string) => Promise<JsonCustodyConflictAuditWriter>;
}

export interface CustodyCleanupBrowserSession {
  readonly browser: Pick<BrowserContext, 'close'>;
  readonly page: Page;
}

function invalidPlanResponse(): BotResponse {
  return { text: '托管冲突清理计划已失效，请重新预览并重新发送确认卡。', metadata: { toolName: 'operations.custodyCleanupExecute', ok: false } };
}

function candidateKey(row: Pick<CustodyConflictRow, 'rowId' | 'platformProductId'>): string {
  return row.platformProductId ?? row.rowId;
}

function planCandidateKey(candidate: CustodyCleanupPlanCandidate): string {
  return candidate.platformProductId;
}

function samePlannedCandidate(row: CustodyConflictRow, candidate: CustodyCleanupPlanCandidate): boolean {
  return row.platformProductId === candidate.platformProductId || row.rowId === candidate.rowId;
}

class PlanBoundCustodyConflictAdapter implements CustodyConflictCleanupAdapter {
  private readonly candidatesByKey: ReadonlyMap<string, CustodyCleanupPlanCandidate>;

  constructor(private readonly inner: CustodyConflictCleanupAdapter, candidates: readonly CustodyCleanupPlanCandidate[]) {
    this.candidatesByKey = new Map(candidates.map((candidate) => [planCandidateKey(candidate), candidate]));
  }

  async openCustodyPage(): Promise<void> {
    await this.inner.openCustodyPage();
  }

  async readCurrentPage(): Promise<CustodyConflictTableSnapshot> {
    return this.filterSnapshot(await this.inner.readCurrentPage());
  }

  async goToPage(pageNumber: number): Promise<CustodyConflictTableSnapshot> {
    return this.filterSnapshot(await this.inner.goToPage(pageNumber));
  }

  async cancelCustody(row: CustodyConflictRow, actionLabel: string): Promise<{ confirmed: boolean; confirmationLabel: string }> {
    if (!this.findPlannedCandidate(row)) throw new Error(`Custody cleanup row ${candidateKey(row)} is not part of the approved immutable plan.`);
    return this.inner.cancelCustody(row, actionLabel);
  }

  private filterSnapshot(snapshot: CustodyConflictTableSnapshot): CustodyConflictTableSnapshot {
    return {
      ...snapshot,
      rows: snapshot.rows.filter((row) => this.findPlannedCandidate(row)),
    };
  }

  private findPlannedCandidate(row: CustodyConflictRow): CustodyCleanupPlanCandidate | undefined {
    const key = candidateKey(row);
    const direct = this.candidatesByKey.get(key);
    if (direct) return direct;
    for (const candidate of this.candidatesByKey.values()) {
      if (samePlannedCandidate(row, candidate)) return candidate;
    }
    return undefined;
  }
}

async function claimCustodyCleanupExecution(outputDir: string, planRef: string): Promise<boolean> {
  const path = join(outputDir, 'latest', 'custody-cleanup-executions', `${planRef}.lock`);
  await mkdir(dirname(path), { recursive: true });
  try {
    const handle = await open(path, 'wx');
    try {
      await handle.writeFile(JSON.stringify({ planRef, claimedAt: new Date().toISOString() }));
    } finally {
      await handle.close();
    }
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return false;
    throw error;
  }
}

async function defaultSessionFactory(config: AgentConfig): Promise<CustodyCleanupBrowserSession> {
  return ensureAuthenticatedMerchantSession(config, { acceptDownloads: false, stage: 'custody-conflict-cleanup-execute' });
}

function defaultAdapterFactory(page: Page, config: AgentConfig): CustodyConflictCleanupAdapter {
  return new PlaywrightCustodyConflictAdapter(page, config.exposureUrl);
}

async function defaultAuditWriterFactory(outputDir: string): Promise<JsonCustodyConflictAuditWriter> {
  return JsonCustodyConflictAuditWriter.create(outputDir);
}

function custodyCleanupExecuteMetadata(ok: boolean, plan: CustodyCleanupPlan, auditPath?: string): Record<string, unknown> {
  return {
    toolName: 'operations.custodyCleanupExecute',
    ok,
    planRef: plan.planRef,
    candidateCount: plan.candidates.length,
    ...(auditPath ? { auditPath } : {}),
  };
}

export async function executeCustodyCleanupPlan(input: CustodyCleanupExecuteInput): Promise<BotResponse> {
  if (!isCustodyCleanupPlanRef(input.planRef)) return invalidPlanResponse();
  let plan: CustodyCleanupPlan;
  try {
    plan = await loadCustodyCleanupPlan(input.config.outputDir, input.planRef, { now: input.now });
  } catch {
    return invalidPlanResponse();
  }
  if (!verifyCustodyCleanupPlanKey(plan, input.confirmationKey)) return invalidPlanResponse();

  const claimed = await claimCustodyCleanupExecution(input.config.outputDir, input.planRef);
  if (!claimed) {
    return { text: '托管冲突清理计划已执行或处理中，请重新预览后再发起。', metadata: custodyCleanupExecuteMetadata(false, plan) };
  }

  const sessionFactory = input.sessionFactory ?? defaultSessionFactory;
  const adapterFactory = input.adapterFactory ?? defaultAdapterFactory;
  const auditWriterFactory = input.auditWriterFactory ?? defaultAuditWriterFactory;
  const { browser, page } = await sessionFactory(input.config);
  try {
    const auditWriter = await auditWriterFactory(input.config.outputDir);
    const adapter = new PlanBoundCustodyConflictAdapter(adapterFactory(page, input.config), plan.candidates);
    const result = await runCustodyConflictCleanup({
      adapter,
      auditWriter,
      execute: true,
      maxCancels: plan.candidates.length,
    });
    const ok = result.cancelledCount === plan.candidates.length;
    return {
      text: [
        ok ? '托管冲突清理执行完成' : '托管冲突清理执行完成但取消数量少于计划，请人工核对',
        `计划候选：${plan.candidates.length}`,
        `已取消托管：${result.cancelledCount}`,
        `执行审计：${result.auditPath}`,
      ].join('\n'),
      metadata: { ...custodyCleanupExecuteMetadata(ok, plan, result.auditPath), cancelledCount: result.cancelledCount },
    };
  } catch (error) {
    return {
      text: `托管冲突清理执行中断：${error instanceof Error ? error.message : String(error)}`,
      metadata: { ...custodyCleanupExecuteMetadata(false, plan), error: error instanceof Error ? error.message : String(error) },
    };
  } finally {
    await browser.close();
  }
}
