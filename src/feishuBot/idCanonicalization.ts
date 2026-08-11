export function readCanonicalNumericId(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^(?=.*[1-9])\d+$/.test(trimmed) ? trimmed : null;
}

export function readCanonicalOpaqueId(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function readCanonicalNumericIdArray(value: unknown, maxItems: number): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) return null;
  const ids: string[] = [];
  for (const item of value) {
    const id = readCanonicalNumericId(item);
    if (!id) return null;
    ids.push(id);
  }
  return [...new Set(ids)];
}
