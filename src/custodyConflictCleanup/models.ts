export interface CustodyConflictRow {
  rowId: string;
  rowIndex: number;
  productName: string;
  platformProductId?: string;
  productStatusLabel: string;
  custodyStatusLabel: string;
  actionLabels: string[];
}

export interface CustodyConflictTableSnapshot {
  pageNumber: number;
  totalPages: number;
  rows: CustodyConflictRow[];
  signature: string;
}

export interface CustodyConflictCancelResult {
  confirmed: boolean;
  confirmationLabel: string;
}

export interface CustodyConflictCleanupAdapter {
  openCustodyPage(): Promise<void>;
  readCurrentPage(): Promise<CustodyConflictTableSnapshot>;
  goToPage(pageNumber: number): Promise<CustodyConflictTableSnapshot>;
  cancelCustody(row: CustodyConflictRow, actionLabel: string): Promise<CustodyConflictCancelResult>;
}

export interface CustodyConflictCleanupResult {
  previewOnly: boolean;
  pagesVisited: number;
  candidatesFound: number;
  cancelledCount: number;
  auditPath: string;
}

export interface CustodyConflictCleanupOptions {
  adapter: CustodyConflictCleanupAdapter;
  auditWriter: CustodyConflictAuditWriter;
  execute: boolean;
  maxPages?: number;
  maxPageSweeps?: number;
  maxCancels?: number;
  maxReadbackAttempts?: number;
}

export type CustodyConflictAuditEvent =
  | { type: 'run_started'; at: string; execute: boolean }
  | { type: 'page_scanned'; at: string; pageNumber: number; totalPages: number; rowCount: number; conflictCount: number; signature: string }
  | { type: 'candidate_previewed'; at: string; pageNumber: number; rowId: string; productName: string; platformProductId?: string; productStatusLabel: string; custodyStatusLabel: string; actionLabels: string[] }
  | { type: 'cancel_requested'; at: string; pageNumber: number; rowId: string; productName: string; actionLabel: string }
  | { type: 'cancel_confirmed'; at: string; pageNumber: number; rowId: string; confirmationLabel: string }
  | { type: 'write_verified'; at: string; pageNumber: number; rowId: string; verificationPageNumber: number; totalPages: number }
  | { type: 'write_unverified'; at: string; pageNumber: number; rowId: string; reason: string }
  | { type: 'run_failed'; at: string; reason: string }
  | { type: 'run_completed'; at: string; pagesVisited: number; candidatesFound: number; cancelledCount: number };

export interface CustodyConflictAuditWriter {
  readonly path: string;
  append(event: CustodyConflictAuditEvent): Promise<void>;
}

export const CUSTODY_CONFLICT_ALLOWED_ACTION_LABELS = ['取消托管', '解除托管'] as const;

export interface CustodyCleanupPlanCandidate {
  readonly pageNumber: number;
  readonly rowId: string;
  readonly productName: string;
  readonly platformProductId: string;
  readonly productStatusLabel: string;
  readonly custodyStatusLabel: string;
  readonly actionLabels: readonly string[];
}

export interface CustodyCleanupPlanSourceAudit {
  readonly path: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly runId: string;
  readonly completedAt: string;
}

export interface CustodyCleanupPlanSummary {
  readonly pagesVisited: 39;
  readonly candidatesFound: number;
  readonly cancelledCount: 0;
}

export interface CustodyCleanupPlan {
  readonly schemaVersion: 1;
  readonly planRef: string;
  readonly confirmationKey: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly ttlMs: number;
  readonly sourceAudit: CustodyCleanupPlanSourceAudit;
  readonly importSummary: CustodyCleanupPlanSummary;
  readonly candidates: readonly CustodyCleanupPlanCandidate[];
}
