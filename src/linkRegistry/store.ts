import { buildLinkRegistryAudit, type LinkRegistryAudit } from './audit.js';
import { aliasDisplayLabel, aliasGroupKey, collectEntryAliases, normalizeAlias } from './alias.js';
import { createLinkRegistryQuery, type LinkRegistryQuery, type ListBySameSkuGroupOptions } from './queryRegistry.js';
import type { LinkRegistryEntry } from './types.js';
import type { LinkRegistryOverrideRisk } from './overrides.js';

export interface LinkRegistryAliasResolutionCandidate {
  sameSkuGroupId: string | null;
  entries: LinkRegistryEntry[];
  candidateInternalProductIds: string[];
  matchedAliases: string[];
  reason: string;
}

export type LinkRegistryAliasResolution =
  | { status: 'not_found'; query: string; normalizedQuery: string; reason: string }
  | { status: 'unique'; query: string; normalizedQuery: string; sameSkuGroupId: string | null; entries: LinkRegistryEntry[]; candidateInternalProductIds: string[]; matchedAliases: string[]; reason: string }
  | { status: 'multiple'; query: string; normalizedQuery: string; candidates: LinkRegistryAliasResolutionCandidate[]; reason: string };

export interface LinkRegistryStore extends LinkRegistryQuery {
  resolveAlias(query: string): LinkRegistryAliasResolution;
  audit(): LinkRegistryAudit;
}

interface AliasMatchGroup {
  key: string;
  sameSkuGroupId: string | null;
  entries: LinkRegistryEntry[];
  matchedAliases: Set<string>;
  topScore: number;
}

function levenshtein(left: string, right: string): number {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;
  const matrix = Array.from({ length: left.length + 1 }, (_, index) => [index]);
  for (let index = 0; index <= right.length; index += 1) matrix[0]![index] = index;
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      matrix[row]![column] = Math.min(
        matrix[row - 1]![column]! + 1,
        matrix[row]![column - 1]! + 1,
        matrix[row - 1]![column - 1]! + cost,
      );
    }
  }
  return matrix[left.length]![right.length]!;
}

function aliasScore(query: ReturnType<typeof normalizeAlias>, candidate: ReturnType<typeof normalizeAlias>): number {
  if (!query || !candidate) return 0;
  if (query.compact === candidate.compact) return 100;
  if (query.brandless && query.brandless === candidate.brandless) return 98;
  if (query.normalized === candidate.normalized) return 96;
  if (query.compact.length >= 4 && (candidate.compact.includes(query.compact) || candidate.brandless.includes(query.compact))) return 86;
  if (query.brandless.length >= 4 && (candidate.compact.includes(query.brandless) || candidate.brandless.includes(query.brandless))) return 84;
  const left = query.brandless || query.compact;
  const right = candidate.brandless || candidate.compact;
  if (left.length >= 5 && right.length >= 5 && Math.abs(left.length - right.length) <= 1 && levenshtein(left, right) <= 1) return 74;
  return 0;
}

function activePreferredEntries(entries: LinkRegistryEntry[]): LinkRegistryEntry[] {
  const activeEntries = entries.filter((entry) => entry.status === 'active');
  return activeEntries.length > 0 ? activeEntries : entries;
}

function candidateReason(entries: LinkRegistryEntry[], matchedAliases: string[]): string {
  const label = entries[0] ? aliasDisplayLabel(entries[0]) : 'unknown';
  return `匹配到 ${label}，命中别名：${matchedAliases.join(' / ')}`;
}

export function createLinkRegistry(entries: LinkRegistryEntry[], overrideRisks: LinkRegistryOverrideRisk[] = []): LinkRegistryStore {
  const query = createLinkRegistryQuery(entries);
  const aliasGroups = new Map<string, AliasMatchGroup>();

  for (const entry of entries) {
    const groupKey = aliasGroupKey(entry);
    const sameSkuGroupId = entry.sameSkuGroupId?.trim() ?? null;
    const group = aliasGroups.get(groupKey) ?? { key: groupKey, sameSkuGroupId, entries: [], matchedAliases: new Set<string>(), topScore: 0 };
    group.entries.push(entry);
    aliasGroups.set(groupKey, group);
  }

  const aliasCatalog = [...aliasGroups.values()].map((group) => ({
    ...group,
    aliases: [...new Set(group.entries.flatMap((entry) => collectEntryAliases(entry)))],
  }));

  return {
    ...query,
    resolveAlias(rawQuery: string): LinkRegistryAliasResolution {
      const queryAlias = normalizeAlias(rawQuery);
      if (!queryAlias) {
        return { status: 'not_found', query: rawQuery, normalizedQuery: '', reason: 'empty_query' };
      }

      const ranked = aliasCatalog
        .map((group) => {
          const scoredAliases = group.aliases
            .map((alias) => ({ alias, score: aliasScore(queryAlias, normalizeAlias(alias)) }))
            .filter((item) => item.score > 0)
            .sort((left, right) => right.score - left.score || left.alias.localeCompare(right.alias));
          if (scoredAliases.length === 0) return null;
          return {
            ...group,
            matchedAliases: [...new Set(scoredAliases.filter((item) => item.score === scoredAliases[0]!.score).map((item) => item.alias))],
            topScore: scoredAliases[0]!.score,
          };
        })
        .filter((item): item is NonNullable<typeof item> => !!item)
        .sort((left, right) => right.topScore - left.topScore || activePreferredEntries(right.entries).length - activePreferredEntries(left.entries).length || (left.sameSkuGroupId ?? left.key).localeCompare(right.sameSkuGroupId ?? right.key));

      if (ranked.length === 0 || ranked[0]!.topScore < 74) {
        return { status: 'not_found', query: rawQuery, normalizedQuery: queryAlias.compact, reason: 'no_alias_match' };
      }

      const topScore = ranked[0]!.topScore;
      const contenders = ranked.filter((item) => item.topScore >= topScore - (topScore >= 96 ? 0 : 3));
      if (contenders.length === 1) {
        const winner = contenders[0]!;
        const resolvedEntries = activePreferredEntries(winner.entries);
        return {
          status: 'unique',
          query: rawQuery,
          normalizedQuery: queryAlias.compact,
          sameSkuGroupId: winner.sameSkuGroupId,
          entries: resolvedEntries,
          candidateInternalProductIds: resolvedEntries.map((entry) => entry.internalProductId),
          matchedAliases: winner.matchedAliases,
          reason: candidateReason(winner.entries, winner.matchedAliases),
        };
      }

      return {
        status: 'multiple',
        query: rawQuery,
        normalizedQuery: queryAlias.compact,
        candidates: contenders.map((item) => {
          const resolvedEntries = activePreferredEntries(item.entries);
          return {
            sameSkuGroupId: item.sameSkuGroupId,
            entries: resolvedEntries,
            candidateInternalProductIds: resolvedEntries.map((entry) => entry.internalProductId),
            matchedAliases: item.matchedAliases,
            reason: candidateReason(item.entries, item.matchedAliases),
          };
        }),
        reason: 'multiple_same_sku_group_candidates',
      };
    },
    listBySameSkuGroup(sameSkuGroupId: string, options?: ListBySameSkuGroupOptions): LinkRegistryEntry[] {
      return query.listBySameSkuGroup(sameSkuGroupId, options);
    },
    audit(): LinkRegistryAudit {
      return buildLinkRegistryAudit(entries, overrideRisks);
    },
  };
}
