export function dedupeRowsByProductId(headers: string[], rows: string[][]): string[][] {
  const productIdIndex = headers.findIndex((header) => header.includes('商品ID'));

  if (productIdIndex < 0) {
    return rows;
  }

  const byId = new Map<string, string[]>();

  for (const row of rows) {
    const productId = row[productIdIndex] ?? '';

    if (productId) {
      byId.set(productId, row);
    }
  }

  return Array.from(byId.values());
}

export function isCollectionComplete(dedupedRowCount: number, displayedTotalCount: number | null, nextPageDisabled: boolean): boolean {
  if (displayedTotalCount !== null) {
    return dedupedRowCount === displayedTotalCount;
  }

  return nextPageDisabled;
}
