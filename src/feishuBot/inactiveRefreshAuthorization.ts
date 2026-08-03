export function parseInactiveRefreshApproverIds(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean))];
}

export function parseCustodyCleanupApproverIds(value: string | undefined): string[] {
  return parseInactiveRefreshApproverIds(value);
}

export function canApproveInactiveRefresh(actorIds: string | readonly string[] | undefined, approverIds: readonly string[] | undefined): boolean {
  if (!approverIds?.length) return false;
  if (approverIds.includes('*')) return true;
  const ids = Array.isArray(actorIds) ? actorIds : actorIds ? [actorIds] : [];
  return ids.some((id) => approverIds.includes(id));
}

export function canApproveCustodyCleanup(actorIds: string | readonly string[] | undefined, approverIds: readonly string[] | undefined): boolean {
  return canApproveInactiveRefresh(actorIds, approverIds);
}
