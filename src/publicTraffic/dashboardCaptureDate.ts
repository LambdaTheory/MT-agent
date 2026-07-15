export interface DashboardDateReadback {
  requestedDate: string;
  displayedValue: string;
  confirmed: boolean;
  reason?: string;
}

/**
 * Format a Date as YYYY-MM-DD in Asia/Shanghai timezone.
 * Uses Intl.DateTimeFormat with formatToParts() for correct calendar semantics.
 * Never uses toISOString() for Shanghai calendar dates.
 */
export function formatShanghaiDate(now?: Date): string {
  const d = now ?? new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(d);
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${year}-${month}-${day}`;
}

/**
 * Return the previous calendar day in Asia/Shanghai timezone.
 */
export function offsetShanghaiDate(days: number, now?: Date): string {
  const d = now ?? new Date();
  // Get current Shanghai date components
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(d);
  const year = Number(parts.find((p) => p.type === 'year')?.value ?? '0');
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? '0');
  const day = Number(parts.find((p) => p.type === 'day')?.value ?? '0');

  // Construct a Date in UTC that represents the Shanghai calendar date,
  // then apply the calendar-day offset.
  const shanghaiDate = new Date(Date.UTC(year, month - 1, day));
  shanghaiDate.setUTCDate(shanghaiDate.getUTCDate() + days);

  const y = shanghaiDate.getUTCFullYear();
  const m = String(shanghaiDate.getUTCMonth() + 1).padStart(2, '0');
  const d2 = String(shanghaiDate.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d2}`;
}

export function previousShanghaiDate(now?: Date): string {
  return offsetShanghaiDate(-1, now);
}

/**
 * Validate a dashboard data date string.
 * - Must be YYYY-MM-DD format
 * - Must be a valid calendar date
 * - Must not be in the future (relative to Asia/Shanghai)
 *
 * Returns the normalized date string on success, throws on failure.
 */
export function assertDashboardDataDate(date: string, now?: Date): string {
  // Must match YYYY-MM-DD format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('dataDate must be YYYY-MM-DD');
  }

  // Validate it's a real calendar date using UTC constructor + round-trip
  const [y, m, d] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (
    parsed.getUTCFullYear() !== y ||
    parsed.getUTCMonth() !== m - 1 ||
    parsed.getUTCDate() !== d
  ) {
    throw new Error('dataDate must be YYYY-MM-DD');
  }

  // Check not in the future (relative to Shanghai)
  const today = formatShanghaiDate(now);
  if (date > today) {
    throw new Error('dataDate must not be in the future');
  }

  return date;
}

/**
 * Assess whether the dashboard date picker's displayed value matches
 * the requested date. Handles various display formats:
 * - MM-DD (e.g. "07-12")
 * - YYYY/MM/DD (e.g. "2026/07/12")
 * - YYYY-MM-DD (e.g. "2026-07-12")
 * - Date ranges whose end date is the requested cutoff (e.g. "07-06 ~ 07-12")
 */
function parseDisplayedDashboardDate(token: string, requestedYear: string): string | null {
  const normalized = token.trim();
  const slashMatch = normalized.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (slashMatch) return `${slashMatch[1]}-${slashMatch[2]}-${slashMatch[3]}`;

  const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const mmddMatch = normalized.match(/^(\d{2})-(\d{2})$/);
  if (mmddMatch) return `${requestedYear}-${mmddMatch[1]}-${mmddMatch[2]}`;

  return null;
}

export function assessDashboardDateReadback(
  requestedDate: string,
  displayedValue: string,
): DashboardDateReadback {
  const normalized = displayedValue.trim();
  const requestedYear = requestedDate.slice(0, 4);

  if (/[~～]/.test(normalized)) {
    const parts = normalized.split(/[~～]/).map((part) => part.trim()).filter(Boolean);
    const displayedEndDate = parts.length === 2 ? parseDisplayedDashboardDate(parts[1], requestedYear) : null;
    return {
      requestedDate,
      displayedValue: normalized,
      confirmed: displayedEndDate === requestedDate,
      reason: displayedEndDate === requestedDate ? undefined : 'picker date range end does not match requested date',
    };
  }

  const displayedDate = parseDisplayedDashboardDate(normalized, requestedYear);
  if (displayedDate) {
    return {
      requestedDate,
      displayedValue: normalized,
      confirmed: displayedDate === requestedDate,
      reason: displayedDate === requestedDate ? undefined : 'picker date does not match requested date',
    };
  }

  return {
    requestedDate,
    displayedValue: normalized,
    confirmed: false,
    reason: 'picker date does not match requested date',
  };
}
