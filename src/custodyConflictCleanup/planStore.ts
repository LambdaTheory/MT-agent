import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonAtomic } from '../linkRegistry/persistence.js';
import type { CustodyCleanupPlan, CustodyCleanupPlanCandidate } from './models.js';
import { isCustodyConflictCandidate, selectAllowedCustodyCancelAction } from './workflow.js';

const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000;
const EXPECTED_PAGES_VISITED = 39;
const EXPECTED_CANCELLED_COUNT = 0;
const PLAN_REF_PATTERN = /^custody-cleanup-plan-[a-f0-9]{24}$/;
const PLATFORM_PRODUCT_ID_PATTERN = /^\d{20,}$/;
const MUTATION_EVENTS = new Set(['cancel_requested', 'cancel_confirmed', 'write_verified', 'write_unverified']);

interface ImportOptions {
  readonly now?: Date;
  readonly ttlMs?: number;
}

interface LoadOptions {
  readonly now?: Date;
}

interface AuditDocument {
  readonly runId: string;
  readonly createdAt: string;
  readonly events: readonly AuditEvent[];
}

type AuditEvent =
  | AuditRunStartedEvent
  | AuditPageScannedEvent
  | AuditCandidatePreviewedEvent
  | AuditRunCompletedEvent
  | AuditOtherEvent;

interface AuditRunStartedEvent {
  readonly type: 'run_started';
  readonly at: string;
  readonly execute: boolean;
}

interface AuditPageScannedEvent {
  readonly type: 'page_scanned';
  readonly at: string;
  readonly pageNumber: number;
  readonly totalPages: number;
  readonly rowCount: number;
  readonly conflictCount: number;
  readonly signature: string;
}

interface AuditCandidatePreviewedEvent {
  readonly type: 'candidate_previewed';
  readonly at: string;
  readonly pageNumber: number;
  readonly rowId: string;
  readonly productName: string;
  readonly platformProductId: string;
  readonly productStatusLabel: string;
  readonly custodyStatusLabel: string;
  readonly actionLabels: readonly string[];
}

interface AuditRunCompletedEvent {
  readonly type: 'run_completed';
  readonly at: string;
  readonly pagesVisited: number;
  readonly candidatesFound: number;
  readonly cancelledCount: number;
}

interface AuditOtherEvent {
  readonly type: string;
  readonly at?: string;
}

function sha256Hex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  const label = key === 'platformProductId' ? 'platform product id' : key;
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Custody cleanup audit is missing string field ${label}.`);
  return value;
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Custody cleanup audit is missing numeric field ${key}.`);
  return value;
}

function requiredBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') throw new Error(`Custody cleanup audit is missing boolean field ${key}.`);
  return value;
}

function requiredStringArray(record: Record<string, unknown>, key: string): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Custody cleanup audit is missing string array field ${key}.`);
  }
  return value;
}

function parseIsoDate(value: string, label: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) throw new Error(`Custody cleanup audit has invalid ${label}.`);
  return date;
}

function parseAuditEvent(value: unknown): AuditEvent {
  if (!isRecord(value)) throw new Error('Custody cleanup audit event must be an object.');
  const type = requiredString(value, 'type');
  if (type === 'run_started') {
    return { type, at: requiredString(value, 'at'), execute: requiredBoolean(value, 'execute') };
  }
  if (type === 'page_scanned') {
    return {
      type,
      at: requiredString(value, 'at'),
      pageNumber: requiredNumber(value, 'pageNumber'),
      totalPages: requiredNumber(value, 'totalPages'),
      rowCount: requiredNumber(value, 'rowCount'),
      conflictCount: requiredNumber(value, 'conflictCount'),
      signature: requiredString(value, 'signature'),
    };
  }
  if (type === 'candidate_previewed') {
    return {
      type,
      at: requiredString(value, 'at'),
      pageNumber: requiredNumber(value, 'pageNumber'),
      rowId: requiredString(value, 'rowId'),
      productName: requiredString(value, 'productName'),
      platformProductId: requiredString(value, 'platformProductId'),
      productStatusLabel: requiredString(value, 'productStatusLabel'),
      custodyStatusLabel: requiredString(value, 'custodyStatusLabel'),
      actionLabels: requiredStringArray(value, 'actionLabels'),
    };
  }
  if (type === 'run_completed') {
    return {
      type,
      at: requiredString(value, 'at'),
      pagesVisited: requiredNumber(value, 'pagesVisited'),
      candidatesFound: requiredNumber(value, 'candidatesFound'),
      cancelledCount: requiredNumber(value, 'cancelledCount'),
    };
  }
  const at = value.at;
  return typeof at === 'string' ? { type, at } : { type };
}

function parseAuditDocument(raw: Buffer): AuditDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    throw new Error(`Custody cleanup audit must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) throw new Error('Custody cleanup audit must be a JSON object.');
  const eventsValue = parsed.events;
  if (!Array.isArray(eventsValue)) throw new Error('Custody cleanup audit must include an events array.');
  return {
    runId: requiredString(parsed, 'runId'),
    createdAt: requiredString(parsed, 'createdAt'),
    events: eventsValue.map(parseAuditEvent),
  };
}

function assertNoMutationEvents(events: readonly AuditEvent[]): void {
  const failure = events.find((event) => event.type === 'run_failed');
  if (failure) throw new Error('Custody cleanup preview audit contains run_failed event.');
  const mutation = events.find((event) => MUTATION_EVENTS.has(event.type));
  if (mutation) throw new Error(`Custody cleanup preview audit contains mutation event ${mutation.type}.`);
}

function requireSingleRunStarted(events: readonly AuditEvent[]): AuditRunStartedEvent {
  const runStartedEvents = events.filter((event): event is AuditRunStartedEvent => event.type === 'run_started');
  if (runStartedEvents.length !== 1) throw new Error('Custody cleanup audit must contain exactly one run_started event.');
  const [runStarted] = runStartedEvents;
  if (!runStarted || runStarted.execute !== false) throw new Error('Custody cleanup audit run_started must have execute:false.');
  return runStarted;
}

function requireTerminalRunCompleted(events: readonly AuditEvent[]): AuditRunCompletedEvent {
  const completedEvents = events.filter((event): event is AuditRunCompletedEvent => event.type === 'run_completed');
  if (completedEvents.length !== 1) throw new Error('Custody cleanup audit must contain exactly one run_completed event.');
  const terminal = events.at(-1);
  if (!terminal || terminal.type !== 'run_completed') throw new Error('Custody cleanup audit must end with terminal run_completed.');
  const completed = completedEvents[0];
  if (!completed) throw new Error('Custody cleanup audit must contain run_completed.');
  if (completed.pagesVisited !== EXPECTED_PAGES_VISITED) throw new Error('Custody cleanup audit run_completed must report pagesVisited:39.');
  if (!Number.isInteger(completed.candidatesFound) || completed.candidatesFound <= 0) throw new Error('Custody cleanup audit run_completed must report a positive integer candidatesFound.');
  if (completed.cancelledCount !== EXPECTED_CANCELLED_COUNT) throw new Error('Custody cleanup audit run_completed must report cancelledCount:0.');
  return completed;
}

function requirePageScanCount(events: readonly AuditEvent[]): void {
  const pageScans = events.filter((event): event is AuditPageScannedEvent => event.type === 'page_scanned');
  if (pageScans.length !== EXPECTED_PAGES_VISITED) throw new Error('Custody cleanup audit must include exactly 39 page_scanned events.');
  if (pageScans.some((event) => event.totalPages !== EXPECTED_PAGES_VISITED)) {
    throw new Error('Custody cleanup audit page_scanned events must report totalPages:39.');
  }
  const seenPages = new Set<number>();
  for (const scan of pageScans) {
    if (!Number.isInteger(scan.pageNumber) || scan.pageNumber < 1 || scan.pageNumber > EXPECTED_PAGES_VISITED) {
      throw new Error('Custody cleanup audit page_scanned events must cover pages 1..39 exactly once.');
    }
    if (seenPages.has(scan.pageNumber)) throw new Error('Custody cleanup audit page_scanned events must cover pages 1..39 exactly once.');
    seenPages.add(scan.pageNumber);
  }
  if (seenPages.size !== EXPECTED_PAGES_VISITED) throw new Error('Custody cleanup audit page_scanned events must cover pages 1..39 exactly once.');
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function assertCandidateSemantics(candidate: CustodyCleanupPlanCandidate): void {
  if (!Number.isInteger(candidate.pageNumber) || candidate.pageNumber < 1 || candidate.pageNumber > EXPECTED_PAGES_VISITED) {
    throw new Error('Custody cleanup candidate pageNumber must be an integer in 1..39.');
  }
  if (!PLATFORM_PRODUCT_ID_PATTERN.test(candidate.platformProductId)) {
    throw new Error('Custody cleanup candidate must include a product-like platform product id.');
  }
  if (normalizeText(candidate.productStatusLabel) !== '已下架') {
    throw new Error('Custody cleanup candidate productStatusLabel must be 已下架.');
  }
  const row = {
    rowId: candidate.rowId,
    rowIndex: 0,
    productName: candidate.productName,
    platformProductId: candidate.platformProductId,
    productStatusLabel: candidate.productStatusLabel,
    custodyStatusLabel: candidate.custodyStatusLabel,
    actionLabels: [...candidate.actionLabels],
  };
  if (!isCustodyConflictCandidate(row)) {
    throw new Error('Custody cleanup candidate custodyStatusLabel is not an explicit supported custody conflict status.');
  }
  if (!selectAllowedCustodyCancelAction(row)) {
    throw new Error('Custody cleanup candidate must include an allowed action label.');
  }
}

function assertCandidateSet(candidates: readonly CustodyCleanupPlanCandidate[], source: string, expectedCandidateCount: number): void {
  if (candidates.length !== expectedCandidateCount) throw new Error(`Custody cleanup ${source} candidate count must match run_completed candidatesFound.`);
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const platformProductId = candidate.platformProductId.trim();
    if (!platformProductId) throw new Error('Custody cleanup candidate must include a platform product id.');
    if (seen.has(platformProductId)) throw new Error(`Custody cleanup ${source} contains duplicate platform product id ${platformProductId}.`);
    seen.add(platformProductId);
    assertCandidateSemantics({ ...candidate, platformProductId });
  }
}

function collectCandidates(events: readonly AuditEvent[], expectedCandidateCount: number): readonly CustodyCleanupPlanCandidate[] {
  const candidates = events.filter((event): event is AuditCandidatePreviewedEvent => event.type === 'candidate_previewed');
  if (candidates.length !== expectedCandidateCount) throw new Error('Custody cleanup audit candidate_previewed count must match run_completed candidatesFound.');

  const planCandidates = candidates.map((candidate) => {
    const platformProductId = candidate.platformProductId.trim();
    return {
      pageNumber: candidate.pageNumber,
      rowId: candidate.rowId,
      productName: candidate.productName,
      platformProductId,
      productStatusLabel: candidate.productStatusLabel,
      custodyStatusLabel: candidate.custodyStatusLabel,
      actionLabels: [...candidate.actionLabels],
    };
  });
  assertCandidateSet(planCandidates, 'audit', expectedCandidateCount);
  return planCandidates;
}

function assertFresh(completedAt: string, now: Date, ttlMs: number): void {
  const completedDate = parseIsoDate(completedAt, 'run_completed.at');
  if (ttlMs <= 0 || !Number.isFinite(ttlMs)) throw new Error('Custody cleanup plan TTL must be positive.');
  if (now.getTime() >= completedDate.getTime() + ttlMs) throw new Error('Custody cleanup audit is expired or stale.');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function planForConfirmation(plan: CustodyCleanupPlan): Omit<CustodyCleanupPlan, 'confirmationKey'> {
  return {
    schemaVersion: plan.schemaVersion,
    planRef: plan.planRef,
    createdAt: plan.createdAt,
    expiresAt: plan.expiresAt,
    ttlMs: plan.ttlMs,
    sourceAudit: plan.sourceAudit,
    importSummary: plan.importSummary,
    candidates: plan.candidates,
  };
}

function assertPlanShape(value: unknown): CustodyCleanupPlan {
  if (!isRecord(value)) throw new Error('Custody cleanup plan file must be a JSON object.');
  if (value.schemaVersion !== 1) throw new Error('Custody cleanup plan schemaVersion must be 1.');
  const planRef = requiredString(value, 'planRef');
  const confirmationKey = requiredString(value, 'confirmationKey');
  const createdAt = requiredString(value, 'createdAt');
  const expiresAt = requiredString(value, 'expiresAt');
  const ttlMs = requiredNumber(value, 'ttlMs');
  if (!isRecord(value.sourceAudit)) throw new Error('Custody cleanup plan sourceAudit must be an object.');
  if (!isRecord(value.importSummary)) throw new Error('Custody cleanup plan importSummary must be an object.');
  if (!Array.isArray(value.candidates)) throw new Error('Custody cleanup plan candidates must be an array.');
  return {
    schemaVersion: 1,
    planRef,
    confirmationKey,
    createdAt,
    expiresAt,
    ttlMs,
    sourceAudit: {
      path: requiredString(value.sourceAudit, 'path'),
      sha256: requiredString(value.sourceAudit, 'sha256'),
      byteLength: requiredNumber(value.sourceAudit, 'byteLength'),
      runId: requiredString(value.sourceAudit, 'runId'),
      completedAt: requiredString(value.sourceAudit, 'completedAt'),
    },
    importSummary: {
      pagesVisited: value.importSummary.pagesVisited === EXPECTED_PAGES_VISITED ? EXPECTED_PAGES_VISITED : requiredNumber(value.importSummary, 'pagesVisited') as 39,
      candidatesFound: requiredNumber(value.importSummary, 'candidatesFound'),
      cancelledCount: value.importSummary.cancelledCount === EXPECTED_CANCELLED_COUNT ? EXPECTED_CANCELLED_COUNT : requiredNumber(value.importSummary, 'cancelledCount') as 0,
    },
    candidates: value.candidates.map((candidate) => {
      if (!isRecord(candidate)) throw new Error('Custody cleanup plan candidate must be an object.');
      return {
        pageNumber: requiredNumber(candidate, 'pageNumber'),
        rowId: requiredString(candidate, 'rowId'),
        productName: requiredString(candidate, 'productName'),
        platformProductId: requiredString(candidate, 'platformProductId'),
        productStatusLabel: requiredString(candidate, 'productStatusLabel'),
        custodyStatusLabel: requiredString(candidate, 'custodyStatusLabel'),
        actionLabels: requiredStringArray(candidate, 'actionLabels'),
      };
    }),
  };
}

function assertCanonicalPlan(plan: CustodyCleanupPlan): void {
  if (!isCustodyCleanupPlanRef(plan.planRef)) throw new Error('Custody cleanup plan has an invalid planRef.');
  if (!/^[a-f0-9]{64}$/.test(plan.sourceAudit.sha256)) throw new Error('Custody cleanup plan source audit sha256 is invalid.');
  if (!plan.planRef.endsWith(plan.sourceAudit.sha256.slice(0, 24))) throw new Error('Custody cleanup planRef is not bound to the source audit hash.');
  if (plan.importSummary.pagesVisited !== EXPECTED_PAGES_VISITED || plan.importSummary.cancelledCount !== EXPECTED_CANCELLED_COUNT) {
    throw new Error('Custody cleanup plan summary is not canonical.');
  }
  if (!Number.isInteger(plan.importSummary.candidatesFound) || plan.importSummary.candidatesFound <= 0) throw new Error('Custody cleanup plan candidatesFound must be a positive integer.');
  assertCandidateSet(plan.candidates, 'plan', plan.importSummary.candidatesFound);
  const computed = custodyCleanupPlanConfirmationKey(plan);
  if (computed !== plan.confirmationKey) throw new Error('Custody cleanup plan confirmation key mismatch; file may be tampered.');
}

export function isCustodyCleanupPlanRef(value: string): boolean {
  return PLAN_REF_PATTERN.test(value);
}

export function custodyCleanupPlanConfirmationKey(plan: CustodyCleanupPlan): string {
  return sha256Hex(canonicalJson(planForConfirmation(plan)));
}

export function verifyCustodyCleanupPlanKey(plan: CustodyCleanupPlan, key: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(key)) return false;
  const expected = Buffer.from(custodyCleanupPlanConfirmationKey(plan), 'hex');
  const actual = Buffer.from(key, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function importCustodyPreviewAudit(auditPath: string, options: ImportOptions = {}): Promise<CustodyCleanupPlan> {
  const raw = await readFile(auditPath);
  const audit = parseAuditDocument(raw);
  assertNoMutationEvents(audit.events);
  requireSingleRunStarted(audit.events);
  const completed = requireTerminalRunCompleted(audit.events);
  requirePageScanCount(audit.events);

  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? new Date();
  assertFresh(completed.at, now, ttlMs);

  const sourceHash = sha256Hex(raw);
  const planRef = `custody-cleanup-plan-${sourceHash.slice(0, 24)}`;
  const createdAt = completed.at;
  const planWithoutKey: Omit<CustodyCleanupPlan, 'confirmationKey'> = {
    schemaVersion: 1,
    planRef,
    createdAt,
    expiresAt: new Date(parseIsoDate(completed.at, 'run_completed.at').getTime() + ttlMs).toISOString(),
    ttlMs,
    sourceAudit: {
      path: auditPath,
      sha256: sourceHash,
      byteLength: raw.byteLength,
      runId: audit.runId,
      completedAt: completed.at,
    },
    importSummary: {
      pagesVisited: EXPECTED_PAGES_VISITED,
      candidatesFound: completed.candidatesFound,
      cancelledCount: EXPECTED_CANCELLED_COUNT,
    },
    candidates: collectCandidates(audit.events, completed.candidatesFound),
  };
  const plan = { ...planWithoutKey, confirmationKey: sha256Hex(canonicalJson(planWithoutKey)) };
  assertCanonicalPlan(plan);
  return plan;
}

export async function saveCustodyCleanupPlan(plan: CustodyCleanupPlan, outputDir: string): Promise<string> {
  assertCanonicalPlan(plan);
  const planPath = join(outputDir, 'latest', 'custody-cleanup-plans', `${plan.planRef}.json`);
  await writeJsonAtomic(planPath, plan);
  return planPath;
}

export async function loadCustodyCleanupPlan(outputDir: string, planRef: string, options: LoadOptions = {}): Promise<CustodyCleanupPlan> {
  if (!isCustodyCleanupPlanRef(planRef)) throw new Error('Custody cleanup planRef is invalid.');
  const planPath = join(outputDir, 'latest', 'custody-cleanup-plans', `${planRef}.json`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(planPath, 'utf8'));
  } catch (error) {
    throw new Error(`Custody cleanup plan could not be loaded as valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const plan = assertPlanShape(parsed);
  if (plan.planRef !== planRef) throw new Error('Custody cleanup planRef does not match the requested file.');
  assertCanonicalPlan(plan);
  const now = options.now ?? new Date();
  const expiresAt = parseIsoDate(plan.expiresAt, 'expiresAt');
  if (now.getTime() >= expiresAt.getTime()) throw new Error('Custody cleanup plan is expired or stale.');
  return plan;
}
