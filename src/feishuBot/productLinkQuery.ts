import type { ProductQueryResult } from '../agentData/productQuery.js';
import { parseNumericProductQueryList } from '../agentData/productQuery.js';
import type { PublicTrafficDataReportContext } from '../publicTraffic/types.js';
import type { BotResponse } from './types.js';
import { buildProblemSectionCard, buildProductDetailCard } from './queryCards.js';
import { buildQueryFullListRef } from './queryFullListAction.js';
import { buildReportSectionCardData, runPublicTrafficReportQuery, type PublicTrafficReportQueryArguments, type ReportSectionName } from './reportQuery.js';
import { formatProductQueryResult, queryProductResult } from './reportStore.js';

export const productLinkQueryTypes = [
  'productDetail',
  'productList',
  'problemPool',
  'problemPoolCounts',
  'sourceCoverage',
  'linkStatus',
] as const;

export type ProductLinkQueryType = typeof productLinkQueryTypes[number];

export interface ProductLinkQueryArguments {
  queryType?: ProductLinkQueryType;
  date?: string;
  productQuery?: string;
  section?: ReportSectionName;
  period?: PublicTrafficReportQueryArguments['period'];
  periods?: PublicTrafficReportQueryArguments['periods'];
  metrics?: PublicTrafficReportQueryArguments['metrics'];
  filters?: PublicTrafficReportQueryArguments['filters'];
  sortBy?: PublicTrafficReportQueryArguments['sortBy'];
  sortDirection?: PublicTrafficReportQueryArguments['sortDirection'];
  limit?: PublicTrafficReportQueryArguments['limit'];
  source?: PublicTrafficReportQueryArguments['source'];
  coverageStatus?: PublicTrafficReportQueryArguments['coverageStatus'];
  display?: 'auto' | 'card' | 'text' | 'fullText';
}

export interface ProductLinkQueryExecution {
  response: BotResponse;
  result?: ProductQueryResult;
  productIds: string[];
}

function productIdsFromResult(result: ProductQueryResult): string[] {
  return result.matches.map((match) => match.internalProductId);
}

function queryTypeFromArgs(args: ProductLinkQueryArguments): ProductLinkQueryType {
  if (args.queryType) return args.queryType;
  if (args.section) return 'problemPool';
  if (args.source || args.coverageStatus) return 'sourceCoverage';
  const productQuery = args.productQuery?.trim() ?? '';
  return parseNumericProductQueryList(productQuery).length > 1 ? 'productList' : 'productDetail';
}

function problemPoolReportArgs(args: ProductLinkQueryArguments): PublicTrafficReportQueryArguments {
  return {
    target: 'section',
    section: args.section ?? 'recommendedActions',
    ...(args.filters ? { filters: args.filters } : {}),
    ...(args.sortBy ? { sortBy: args.sortBy } : {}),
    ...(args.sortDirection ? { sortDirection: args.sortDirection } : {}),
    ...(args.limit ? { limit: args.limit } : {}),
  };
}

function sourceCoverageReportArgs(args: ProductLinkQueryArguments): PublicTrafficReportQueryArguments {
  return {
    target: 'sourceCoverage',
    ...(args.productQuery ? { productQuery: args.productQuery } : {}),
    ...(args.period ? { period: args.period } : {}),
    ...(args.source ? { source: args.source } : {}),
    ...(args.coverageStatus ? { coverageStatus: args.coverageStatus } : {}),
    ...(args.limit ? { limit: args.limit } : {}),
  };
}

export function runProductLinkQuery(context: PublicTrafficDataReportContext, args: ProductLinkQueryArguments): ProductLinkQueryExecution {
  const queryType = queryTypeFromArgs(args);

  if (queryType === 'problemPoolCounts') {
    const text = runPublicTrafficReportQuery(context, { target: 'sectionCounts' });
    return { response: { text, metadata: { toolName: 'productLink.query', queryType, date: context.date } }, productIds: [] };
  }

  if (queryType === 'problemPool' || queryType === 'linkStatus') {
    const reportArgs = problemPoolReportArgs(args);
    const text = runPublicTrafficReportQuery(context, reportArgs);
    const sectionData = buildReportSectionCardData(context, reportArgs);
    if (!sectionData) return { response: { text, metadata: { toolName: 'productLink.query', queryType, date: context.date } }, productIds: [] };
    const productIds = sectionData.rows.map((row) => row.id.replace(/^端内ID\s*/i, ''));
    const result = queryProductResult(context, productIds.join(','));
    const section = reportArgs.section ?? 'recommendedActions';
    const queryRef = buildQueryFullListRef({
      date: context.date,
      section,
      ...(reportArgs.filters ? { filters: reportArgs.filters } : {}),
      ...(reportArgs.sortBy ? { sortBy: reportArgs.sortBy } : {}),
      ...(reportArgs.sortDirection ? { sortDirection: reportArgs.sortDirection } : {}),
    });
    return {
      response: {
        text,
        card: args.display === 'text' || args.display === 'fullText' ? undefined : buildProblemSectionCard({
          title: sectionData.label,
          context,
          result,
          actionRows: sectionData.rows.map((row, index) => ({ ...row, id: productIds[index] ?? row.id })),
          total: sectionData.total,
          queryRef,
        }),
        metadata: {
          toolName: 'productLink.query',
          queryType,
          date: context.date,
          section,
          count: sectionData.total,
          shownCount: Math.min(sectionData.rows.length, 5),
          productIds,
          queryRef,
        },
      },
      result,
      productIds,
    };
  }

  if (queryType === 'sourceCoverage') {
    const text = runPublicTrafficReportQuery(context, sourceCoverageReportArgs(args));
    return { response: { text, metadata: { toolName: 'productLink.query', queryType, date: context.date } }, productIds: [] };
  }

  if (queryType === 'productList' && (!args.productQuery?.trim() || args.filters?.length || args.sortBy || args.limit || args.metrics?.length)) {
    const reportArgs: PublicTrafficReportQueryArguments = {
      target: 'products',
      ...(args.productQuery ? { productQuery: args.productQuery } : {}),
      ...(args.period ? { period: args.period } : {}),
      ...(args.periods ? { periods: args.periods } : {}),
      ...(args.metrics ? { metrics: args.metrics } : {}),
      ...(args.filters ? { filters: args.filters } : {}),
      ...(args.sortBy ? { sortBy: args.sortBy } : {}),
      ...(args.sortDirection ? { sortDirection: args.sortDirection } : {}),
      ...(args.limit ? { limit: args.limit } : {}),
    };
    return {
      response: {
        text: runPublicTrafficReportQuery(context, reportArgs),
        metadata: {
          toolName: 'productLink.query',
          queryType,
          date: context.date,
          count: context.rows.length,
          shownCount: Number(args.limit ?? 10),
        },
      },
      productIds: [],
    };
  }

  const productQuery = args.productQuery?.trim() ?? '';
  const result = queryProductResult(context, productQuery);
  const text = formatProductQueryResult(result);
  const shouldCard = args.display !== 'text' && args.display !== 'fullText' && result.matches.length === 1;
  const productIds = productIdsFromResult(result);
  return {
    response: {
      text,
      ...(shouldCard ? { card: buildProductDetailCard(context, result) } : {}),
      metadata: {
        toolName: 'productLink.query',
        queryType,
        date: context.date,
        count: result.matches.length,
        shownCount: result.matches.length,
        productIds,
      },
    },
    result,
    productIds,
  };
}
