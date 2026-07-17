import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadClosedOrderRegistryContext } from '../closedOrderFeedback/runtime.js';
import { createLlmProviderFromEnv } from '../llm/openAiCompatibleProvider.js';
import { buildLinkRegistryAudit, type LinkRegistryAudit } from '../linkRegistry/audit.js';
import {
  renderLinkRegistryAuditReviewApprovalMarkdown,
  buildLinkRegistryAuditReviewReport,
  enrichLinkRegistryAuditReviewReportWithLlmSuggestions,
  renderLinkRegistryAuditReviewCsv,
  renderLinkRegistryAuditReviewGuide,
  renderLinkRegistryAuditReviewMarkdown,
} from '../linkRegistry/auditReview.js';
import { buildLinkRegistryMaintenanceReport, type LinkRegistryMaintenanceReport } from '../linkRegistry/maintenance.js';
import type { LinkRegistryOverrideRisk } from '../linkRegistry/overrides.js';
import type { LinkRegistryEntry } from '../linkRegistry/types.js';

function readArg(argv: string[], name: string): string | undefined {
  const flagIndex = argv.indexOf(name);
  if (flagIndex >= 0) return argv[flagIndex + 1];
  return argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseRegistryEntries(value: unknown): LinkRegistryEntry[] {
  if (!Array.isArray(value)) throw new Error('Registry file must contain a LinkRegistryEntry array');
  return value.map((item) => {
    if (
      !isRecord(item)
      || typeof item.internalProductId !== 'string'
      || (item.status !== 'active' && item.status !== 'removed' && item.status !== 'unknown')
      || !Array.isArray(item.source)
    ) {
      throw new Error('Invalid LinkRegistryEntry in registry file');
    }
    return item as unknown as LinkRegistryEntry;
  });
}

async function buildEntriesFromInputs(argv: string[]): Promise<{ entries: LinkRegistryEntry[]; overrideRisks: LinkRegistryOverrideRisk[] }> {
  const registryPath = readArg(argv, '--registry');
  if (registryPath) return { entries: parseRegistryEntries(await readJson(registryPath)), overrideRisks: [] };

  const ctx = await loadClosedOrderRegistryContext({
    ...(readArg(argv, '--product-id-map') ? { productIdMapPath: readArg(argv, '--product-id-map') } : {}),
    ...(readArg(argv, '--product-name-map') ? { productNameMapPath: readArg(argv, '--product-name-map') } : {}),
    ...(readArg(argv, '--first-seen') ? { firstSeenPath: readArg(argv, '--first-seen') } : {}),
    ...(readArg(argv, '--lifecycle') ? { lifecyclePath: readArg(argv, '--lifecycle') } : {}),
    ...(readArg(argv, '--overrides') ? { overridesPath: readArg(argv, '--overrides') } : {}),
  });
  return { entries: ctx.registry, overrideRisks: ctx.overrideRisks };
}

interface AuditBuildResult {
  audit: LinkRegistryAudit;
  maintenance: LinkRegistryMaintenanceReport;
  entries: LinkRegistryEntry[];
}

async function buildReportsFromArgs(argv: string[]): Promise<AuditBuildResult> {
  const input = await buildEntriesFromInputs(argv);
  const referenceDate = readArg(argv, '--reference-date') ?? new Date().toISOString().slice(0, 10);
  return {
    audit: buildLinkRegistryAudit(input.entries, input.overrideRisks),
    maintenance: buildLinkRegistryMaintenanceReport(input.entries, input.overrideRisks, { referenceDate }),
    entries: input.entries,
  };
}

async function writeArtifacts(
  outputDir: string,
  reportDate: string,
  reviewMarkdown: string,
  approvalMarkdown: string,
  reviewCsv: string,
  reviewGuide: string,
  reviewReport: unknown,
): Promise<{ markdownPath: string; approvalMarkdownPath: string; csvPath: string; guidePath: string; jsonPath: string }> {
  const dir = join(outputDir, 'latest', 'link-registry-audit');
  await mkdir(dir, { recursive: true });
  const markdownPath = join(dir, `link-registry-audit-review-${reportDate}.md`);
  const approvalMarkdownPath = join(dir, `link-registry-audit-review-approval-${reportDate}.md`);
  const csvPath = join(dir, `link-registry-audit-review-${reportDate}.csv`);
  const guidePath = join(dir, `link-registry-audit-review-guide-${reportDate}.md`);
  const jsonPath = join(dir, `link-registry-audit-review-${reportDate}.json`);
  await writeFile(markdownPath, `${reviewMarkdown}\n`, 'utf8');
  await writeFile(approvalMarkdownPath, approvalMarkdown, 'utf8');
  await writeFile(csvPath, reviewCsv, 'utf8');
  await writeFile(guidePath, `${reviewGuide}\n`, 'utf8');
  await writeFile(jsonPath, `${JSON.stringify(reviewReport, null, 2)}\n`, 'utf8');
  return { markdownPath, approvalMarkdownPath, csvPath, guidePath, jsonPath };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function readyPercent(maintenance: LinkRegistryMaintenanceReport): string {
  const { readyCount, totalEntries } = maintenance.summary;
  if (totalEntries <= 0) return '0.0%';
  return percent(readyCount / totalEntries);
}

function printSummary(audit: LinkRegistryAudit, maintenance: LinkRegistryMaintenanceReport): void {
  console.log(`现有链接档案盘点: total=${audit.total} active=${audit.active} removed=${audit.removed} unknown=${audit.unknown}`);
  console.log('品类:');
  for (const category of audit.categories) {
    console.log(`- ${category.categoryId}${category.categoryName ? ` ${category.categoryName}` : ''}: active=${category.active} removed=${category.removed} unknown=${category.unknown} total=${category.total}`);
    for (const productType of category.productTypes) {
      console.log(`  - ${productType.productType}: active=${productType.active} removed=${productType.removed} unknown=${productType.unknown} total=${productType.total}`);
    }
  }
  console.log(`分类不明链接: ${audit.unknownEntries.length}`);
  console.log(`同款样本不足分组: ${audit.sameSkuGroups.filter((group) => group.sampleInsufficient).length}`);
  console.log(`风险: ${audit.risks.length}`);
  console.log('维护覆盖率:');
  console.log(`- 完整就绪: ${maintenance.summary.readyCount}/${maintenance.summary.totalEntries} (${readyPercent(maintenance)})`);
  console.log(`- 已归组: ${maintenance.coverage.grouped.ready}/${maintenance.coverage.grouped.total} (${percent(maintenance.coverage.grouped.ratio)})`);
  console.log(`- 已分类: ${maintenance.coverage.classified.ready}/${maintenance.coverage.classified.total} (${percent(maintenance.coverage.classified.ratio)})`);
  console.log(`- 已映射: ${maintenance.coverage.mapped.ready}/${maintenance.coverage.mapped.total} (${percent(maintenance.coverage.mapped.ratio)})`);
  console.log(`待维护队列: ${maintenance.summary.pendingCount}`);
  for (const [index, item] of maintenance.queue.slice(0, 5).entries()) {
    const subject = item.internalProductId ?? item.sameSkuGroupId ?? item.message ?? '未命名项';
    const name = item.productName ?? item.shortName ?? '';
    console.log(`${index + 1}. [${item.priority.toUpperCase()}] ${subject}${name ? ` ${name}` : ''} | ${item.reasonLabels.join('、')}`);
  }
}

export async function runLinkRegistryAuditCli(argv = process.argv.slice(2)): Promise<void> {
  const reports = await buildReportsFromArgs(argv);
  const reportDate = readArg(argv, '--reference-date') ?? new Date().toISOString().slice(0, 10);
  const outputDir = readArg(argv, '--output-dir') ?? 'output';
  let reviewReport = buildLinkRegistryAuditReviewReport({
    audit: reports.audit,
    maintenance: reports.maintenance,
    entries: reports.entries,
  });
  if (hasFlag(argv, '--llm-suggestions')) {
    const provider = createLlmProviderFromEnv(process.env);
    if (provider) reviewReport = await enrichLinkRegistryAuditReviewReportWithLlmSuggestions(reviewReport, { provider });
  }
  const artifacts = await writeArtifacts(
    outputDir,
    reportDate,
    renderLinkRegistryAuditReviewMarkdown(reviewReport),
    renderLinkRegistryAuditReviewApprovalMarkdown(reviewReport),
    renderLinkRegistryAuditReviewCsv(reviewReport),
    renderLinkRegistryAuditReviewGuide(reviewReport),
    reviewReport,
  );
  if (hasFlag(argv, '--json')) {
    console.log(JSON.stringify({ ...reports.audit, maintenance: reports.maintenance, review: reviewReport, artifacts }, null, 2));
    return;
  }
  printSummary(reports.audit, reports.maintenance);
  console.log('审计审批单已生成:');
  console.log(`- Overview Markdown: ${artifacts.markdownPath}`);
  console.log(`- Approval Markdown: ${artifacts.approvalMarkdownPath}`);
  console.log(`- CSV: ${artifacts.csvPath}`);
  console.log(`- Guide: ${artifacts.guidePath}`);
  console.log(`- JSON: ${artifacts.jsonPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLinkRegistryAuditCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
