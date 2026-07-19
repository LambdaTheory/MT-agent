export function parseInactiveRefreshApproverIds(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean))];
}

export function canApproveInactiveRefresh(actorIds: string | readonly string[] | undefined, approverIds: readonly string[] | undefined): boolean {
  if (!approverIds?.length) return false;
  const ids = Array.isArray(actorIds) ? actorIds : actorIds ? [actorIds] : [];
  return ids.some((id) => approverIds.includes(id));
}
