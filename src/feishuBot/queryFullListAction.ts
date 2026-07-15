import { extractInternalProductId, queryProducts } from '../agentData/productQuery.js';
import { findReportContextByDate, formatProductQueryResult } from './reportStore.js';
import { buildReportSectionCardData, reportSectionNames, type PublicTrafficReportQueryArguments, type ReportSectionName } from './reportQuery.js';

interface QueryFullListRef {
  date: string;
  section: ReportSectionName;
  filters?: PublicTrafficReportQueryArguments['filters'];
  sortBy?: PublicTrafficReportQueryArguments['sortBy'];
  sortDirection?: PublicTrafficReportQueryArguments['sortDirection'];
}

function encodeRef(value: QueryFullListRef): string {
  return `q2:${Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')}`;
}

function decodeStructuredRef(queryRef: string): QueryFullListRef | null {
  if (!queryRef.startsWith('q2:')) return null;
  try {
    const value = JSON.parse(Buffer.from(queryRef.slice(3), 'base64url').toString('utf8')) as Partial<QueryFullListRef>;
    if (typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) return null;
    if (!reportSectionNames.includes(value.section as ReportSectionName)) return null;
    return {
      date: value.date,
      section: value.section as ReportSectionName,
      ...(Array.isArray(value.filters) ? { filters: value.filters } : {}),
      ...(typeof value.sortBy === 'string' ? { sortBy: value.sortBy as PublicTrafficReportQueryArguments['sortBy'] } : {}),
      ...(value.sortDirection === 'asc' || value.sortDirection === 'desc' ? { sortDirection: value.sortDirection } : {}),
    };
  } catch {
    return null;
  }
}

export function buildQueryFullListRef(args: QueryFullListRef): string {
  return encodeRef({
    date: args.date,
    section: args.section,
    ...(args.filters?.length ? { filters: args.filters } : {}),
    ...(args.sortBy ? { sortBy: args.sortBy } : {}),
    ...(args.sortDirection ? { sortDirection: args.sortDirection } : {}),
  });
}

export function parseQueryFullListRef(queryRef: unknown): QueryFullListRef | null {
  if (typeof queryRef !== 'string') return null;
  const normalized = queryRef.trim();
  const structured = decodeStructuredRef(normalized);
  if (structured) return structured;
  const match = /^(\d{4}-\d{2}-\d{2}):([A-Za-z]+)$/.exec(normalized);
  if (!match?.[1] || !match[2]) return null;
  if (!reportSectionNames.includes(match[2] as ReportSectionName)) return null;
  return { date: match[1], section: match[2] as ReportSectionName };
}

export async function resolveQueryFullListText(outputDir: string, queryRef: unknown): Promise<string> {
  const parsed = parseQueryFullListRef(queryRef);
  if (!parsed) return '完整清单引用无效或已过期，请重新发起查询。';
  const report = await findReportContextByDate(outputDir, parsed.date);
  if (!report) return `没有找到 ${parsed.date} 的公域日报上下文。`;
  const args: PublicTrafficReportQueryArguments = {
    target: 'section',
    section: parsed.section,
    ...(parsed.filters ? { filters: parsed.filters } : {}),
    ...(parsed.sortBy ? { sortBy: parsed.sortBy } : {}),
    ...(parsed.sortDirection ? { sortDirection: parsed.sortDirection } : {}),
  };
  const section = buildReportSectionCardData(report.context, args);
  if (!section) return '完整清单引用无效或已过期，请重新发起查询。';
  const productIds = section.rows
    .map((row) => extractInternalProductId(row.id) ?? row.id.trim())
    .filter((id) => /^\d+$/.test(id));
  if (!productIds.length) return `${section.label} ${report.context.date}\n暂无数据。`;
  return [
    `${section.label}完整清单 ${report.context.date}`,
    `共 ${section.total} 条`,
    formatProductQueryResult(queryProducts(report.context, productIds.join(','))),
  ].join('\n\n');
}
