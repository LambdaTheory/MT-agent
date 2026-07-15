import { extractInternalProductId, queryProducts } from '../agentData/productQuery.js';
import { findReportContextByDate, formatProductQueryResult } from './reportStore.js';
import { buildReportSectionCardData, reportSectionNames, type PublicTrafficReportQueryArguments, type ReportSectionName } from './reportQuery.js';

export function parseQueryFullListRef(queryRef: unknown): { date: string; section: ReportSectionName } | null {
  if (typeof queryRef !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2}):([A-Za-z]+)$/.exec(queryRef.trim());
  if (!match?.[1] || !match[2]) return null;
  if (!reportSectionNames.includes(match[2] as ReportSectionName)) return null;
  return { date: match[1], section: match[2] as ReportSectionName };
}

export async function resolveQueryFullListText(outputDir: string, queryRef: unknown): Promise<string> {
  const parsed = parseQueryFullListRef(queryRef);
  if (!parsed) return '完整清单引用无效或已过期，请重新发起查询。';
  const report = await findReportContextByDate(outputDir, parsed.date);
  if (!report) return `没有找到 ${parsed.date} 的公域日报上下文。`;
  const args: PublicTrafficReportQueryArguments = { target: 'section', section: parsed.section };
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
