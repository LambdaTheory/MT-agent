import {
  CUSTODY_CONFLICT_ALLOWED_ACTION_LABELS,
  type CustodyConflictCleanupOptions,
  type CustodyConflictCleanupResult,
  type CustodyConflictRow,
  type CustodyConflictTableSnapshot,
} from './models.js';

const DEFAULT_MAX_PAGES = 300;
const DEFAULT_MAX_PAGE_SWEEPS = 80;
const DEFAULT_MAX_CANCELS = 1000;
const DEFAULT_MAX_READBACK_ATTEMPTS = 3;

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isExplicitCustodyStatus(value: string): boolean {
  return /^(?:已托管(?:\s*\d+(?:\.\d+)?\s*天)?|(?:托管中|托管异常)\s+已托管(?:\s*\d+(?:\.\d+)?\s*天)?)$/u.test(normalizeText(value));
}

export function isCustodyConflictCandidate(row: CustodyConflictRow): boolean {
  const productStatus = normalizeText(row.productStatusLabel);
  const custodyStatus = normalizeText(row.custodyStatusLabel);
  return productStatus === '已下架' && isExplicitCustodyStatus(custodyStatus);
}

export function selectAllowedCustodyCancelAction(row: CustodyConflictRow): string | null {
  const labels = row.actionLabels.map((label) => normalizeText(label));
  return CUSTODY_CONFLICT_ALLOWED_ACTION_LABELS.find((allowed) => labels.includes(allowed)) ?? null;
}

function sameRow(left: CustodyConflictRow, right: CustodyConflictRow): boolean {
  if (left.platformProductId && right.platformProductId) return left.platformProductId === right.platformProductId;
  if (left.rowId && right.rowId) return left.rowId === right.rowId;
  return normalizeText(left.productName) === normalizeText(right.productName)
    && normalizeText(left.productStatusLabel) === normalizeText(right.productStatusLabel)
    && normalizeText(left.custodyStatusLabel) === normalizeText(right.custodyStatusLabel);
}

function stillConflicting(snapshot: CustodyConflictTableSnapshot, row: CustodyConflictRow): boolean {
  return snapshot.rows.some((candidate) => sameRow(candidate, row) && isCustodyConflictCandidate(candidate));
}

function candidateKey(row: CustodyConflictRow): string {
  return row.platformProductId ?? row.rowId;
}

async function appendNewCandidates(options: CustodyConflictCleanupOptions, pageNumber: number, rows: CustodyConflictRow[], seenCandidateKeys: Set<string>): Promise<void> {
  for (const row of rows) {
    const key = candidateKey(row);
    if (seenCandidateKeys.has(key)) continue;
    seenCandidateKeys.add(key);
    await options.auditWriter.append({
      type: 'candidate_previewed',
      at: nowIso(),
      pageNumber,
      rowId: row.rowId,
      productName: row.productName,
      ...(row.platformProductId ? { platformProductId: row.platformProductId } : {}),
      productStatusLabel: row.productStatusLabel,
      custodyStatusLabel: row.custodyStatusLabel,
      actionLabels: row.actionLabels,
    });
  }
}

async function verifyWriteReadback(
  options: CustodyConflictCleanupOptions,
  input: { targetPage: number; totalPagesBeforeWrite: number; writtenRow: CustodyConflictRow; originalPageNumber: number; maxReadbackAttempts: number },
): Promise<CustodyConflictTableSnapshot> {
  let latest: CustodyConflictTableSnapshot | null = null;
  let lastReadbackError: string | null = null;
  const readbackTargetPage = Math.min(input.targetPage, input.totalPagesBeforeWrite);

  for (let attempt = 1; attempt <= input.maxReadbackAttempts; attempt += 1) {
    try {
      latest = await options.adapter.goToPage(readbackTargetPage);
      lastReadbackError = null;
    } catch (error) {
      lastReadbackError = error instanceof Error ? error.message : String(error);
      continue;
    }
    const pageReachableAfterShrink = readbackTargetPage > latest.totalPages;
    const expectedPageVisible = pageReachableAfterShrink || latest.pageNumber === readbackTargetPage;
    if (expectedPageVisible && !stillConflicting(latest, input.writtenRow)) {
      await options.auditWriter.append({
        type: 'write_verified',
        at: nowIso(),
        pageNumber: input.originalPageNumber,
        rowId: input.writtenRow.rowId,
        verificationPageNumber: latest.pageNumber,
        totalPages: latest.totalPages,
      });
      return latest;
    }
  }

  await options.auditWriter.append({
    type: 'write_unverified',
    at: nowIso(),
    pageNumber: input.originalPageNumber,
    rowId: input.writtenRow.rowId,
    reason: lastReadbackError
      ? `readback navigation failed after ${input.maxReadbackAttempts} attempts: ${lastReadbackError}`
      : latest
        ? `row remained an explicit custody conflict or target page was not reachable after ${input.maxReadbackAttempts} readback attempts`
        : `no readback snapshot after ${input.maxReadbackAttempts} attempts`,
  });
  throw new Error(`Custody cancellation readback verification failed for row ${input.writtenRow.rowId}.`);
}

export async function runCustodyConflictCleanup(options: CustodyConflictCleanupOptions): Promise<CustodyConflictCleanupResult> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const maxPageSweeps = options.maxPageSweeps ?? DEFAULT_MAX_PAGE_SWEEPS;
  const maxCancels = options.maxCancels ?? DEFAULT_MAX_CANCELS;
  const maxReadbackAttempts = options.maxReadbackAttempts ?? DEFAULT_MAX_READBACK_ATTEMPTS;
  let pagesVisited = 0;
  let cancelledCount = 0;
  const seenCandidateKeys = new Set<string>();

  await options.auditWriter.append({ type: 'run_started', at: nowIso(), execute: options.execute });
  let failureRecorded = false;

  try {
    await options.adapter.openCustodyPage();

    let targetPage = 1;
    while (targetPage <= maxPages) {
      let snapshot = await options.adapter.goToPage(targetPage);
      if (targetPage > snapshot.totalPages) break;

      let pageHasNoConflict = false;
      for (let sweep = 1; sweep <= maxPageSweeps; sweep += 1) {
        if (sweep > 1) snapshot = await options.adapter.readCurrentPage();
        const conflicts = snapshot.rows.filter(isCustodyConflictCandidate);
        pagesVisited += 1;
        await options.auditWriter.append({
          type: 'page_scanned',
          at: nowIso(),
          pageNumber: snapshot.pageNumber,
          totalPages: snapshot.totalPages,
          rowCount: snapshot.rows.length,
          conflictCount: conflicts.length,
          signature: snapshot.signature,
        });

        if (conflicts.length === 0) {
          pageHasNoConflict = true;
          break;
        }

        await appendNewCandidates(options, snapshot.pageNumber, conflicts, seenCandidateKeys);
        if (!options.execute) {
          pageHasNoConflict = true;
          break;
        }

        if (cancelledCount >= maxCancels) {
          throw new Error(`Custody cleanup reached max cancel limit: ${maxCancels}`);
        }

        const targetRow = conflicts[0];
        const actionLabel = selectAllowedCustodyCancelAction(targetRow);
        if (!actionLabel) {
          throw new Error(`No allowed cancel action is visible for custody conflict row ${targetRow.rowId}.`);
        }

        await options.auditWriter.append({
          type: 'cancel_requested',
          at: nowIso(),
          pageNumber: snapshot.pageNumber,
          rowId: targetRow.rowId,
          productName: targetRow.productName,
          actionLabel,
        });

        const cancelResult = await options.adapter.cancelCustody(targetRow, actionLabel);
        if (!cancelResult.confirmed) {
          throw new Error(`Custody cancellation was not confirmed for row ${targetRow.rowId}.`);
        }
        cancelledCount += 1;

        await options.auditWriter.append({
          type: 'cancel_confirmed',
          at: nowIso(),
          pageNumber: snapshot.pageNumber,
          rowId: targetRow.rowId,
          confirmationLabel: cancelResult.confirmationLabel,
        });

        const readback = await verifyWriteReadback(options, {
          targetPage,
          totalPagesBeforeWrite: snapshot.totalPages,
          writtenRow: targetRow,
          originalPageNumber: snapshot.pageNumber,
          maxReadbackAttempts,
        });
        snapshot = readback;
      }

      if (!pageHasNoConflict) {
        throw new Error(`Custody cleanup exceeded sweep limit on page ${targetPage}.`);
      }

      const latestTotalPages = Math.max(1, snapshot.totalPages);
      if (targetPage >= maxPages && latestTotalPages > targetPage) {
        throw new Error(`Custody cleanup page limit ${maxPages} reached before scanning all ${latestTotalPages} pages.`);
      }
      if (targetPage >= latestTotalPages) break;
      targetPage += 1;
    }

    await options.auditWriter.append({
      type: 'run_completed',
      at: nowIso(),
      pagesVisited,
      candidatesFound: seenCandidateKeys.size,
      cancelledCount,
    });

    return {
      previewOnly: !options.execute,
      pagesVisited,
      candidatesFound: seenCandidateKeys.size,
      cancelledCount,
      auditPath: options.auditWriter.path,
    };
  } catch (error) {
    if (!failureRecorded) {
      failureRecorded = true;
      await options.auditWriter.append({
        type: 'run_failed',
        at: nowIso(),
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}
