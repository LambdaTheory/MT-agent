import type { Dirent } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadClosedOrderRegistryContext } from '../closedOrderFeedback/runtime.js';
import type { InventoryStatusSnapshot } from '../inventoryStatus/types.js';
import {
  buildLinkRegistryGroupReviewReport,
  renderLinkRegistryGroupReviewApprovalCsv,
  renderLinkRegistryGroupReviewApprovalGuide,
  renderLinkRegistryGroupReviewMarkdown,
} from '../linkRegistry/groupReview.js';
import { parseLinkRegistryOverrides, type LinkRegistryOverrides } from '../linkRegistry/overrides.js';
import type { LinkRegistryEntry } from '../linkRegistry/types.js';
import { buildPublicTrafficPaths } from '../publicTraffic/paths.js';

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

async function readOptionalJson(path: string): Promise<unknown | null> {
  try {
    return await readJson(path);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseSnapshot(value: unknown): InventoryStatusSnapshot {
  if (!isRecord(value) || !Array.isArray(value.groups) || !isRecord(value.summary)) throw new Error('Invalid inventory snapshot file');
  return value as unknown as InventoryStatusSnapshot;
}

async function latestSnapshotDate(outputDir: string): Promise<string | null> {
  const entries: Dirent[] = await readdir(outputDir, { withFileTypes: true }).catch(() => []);
  const dates = entries
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const date of dates) {
    const snapshotPath = buildPublicTrafficPaths(outputDir, date).sameSkuSnapshot;
    const found = await readOptionalJson(snapshotPath);
    if (found) return date;
  }
  return null;
}

async function loadRegistry(argv: string[], outputDir: string): Promise<{ entries: LinkRegistryEntry[]; overrides: LinkRegistryOverrides | null }> {
  const ctx = await loadClosedOrderRegistryContext({
    ...(readArg(argv, '--product-id-map') ? { productIdMapPath: readArg(argv, '--product-id-map') } : {}),
    ...(readArg(argv, '--product-name-map') ? { productNameMapPath: readArg(argv, '--product-name-map') } : {}),
    ...(readArg(argv, '--first-seen') ? { firstSeenPath: readArg(argv, '--first-seen') } : {}),
    ...(readArg(argv, '--lifecycle') ? { lifecyclePath: readArg(argv, '--lifecycle') } : {}),
    ...(readArg(argv, '--overrides') ? { overridesPath: readArg(argv, '--overrides') } : {}),
    artifactsDir: outputDir,
  });
  const rawOverrides = await readOptionalJson(ctx.resolvedPaths.overridesPath);
  return {
    entries: ctx.registry,
    overrides: rawOverrides ? parseLinkRegistryOverrides(rawOverrides) : null,
  };
}

async function writeArtifacts(
  outputDir: string,
  reportDate: string,
  markdown: string,
  approvalCsv: string,
  approvalGuide: string,
  report: unknown,
): Promise<{ markdownPath: string; jsonPath: string; approvalCsvPath: string; approvalGuidePath: string }> {
  const dir = join(outputDir, 'latest', 'link-registry-group-review');
  await mkdir(dir, { recursive: true });
  const markdownPath = join(dir, `link-registry-group-review-${reportDate}.md`);
  const jsonPath = join(dir, `link-registry-group-review-${reportDate}.json`);
  const approvalCsvPath = join(dir, `link-registry-group-review-approval-${reportDate}.csv`);
  const approvalGuidePath = join(dir, `link-registry-group-review-approval-guide-${reportDate}.md`);
  await writeFile(markdownPath, `${markdown}\n`, 'utf8');
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(approvalCsvPath, approvalCsv, 'utf8');
  await writeFile(approvalGuidePath, `${approvalGuide}\n`, 'utf8');
  return { markdownPath, jsonPath, approvalCsvPath, approvalGuidePath };
}

export async function runLinkRegistryGroupReviewCli(argv = process.argv.slice(2)): Promise<void> {
  const outputDir = readArg(argv, '--output-dir') ?? 'output';
  const snapshotDate = readArg(argv, '--snapshot-date') ?? await latestSnapshotDate(outputDir);
  if (!snapshotDate) throw new Error('No same-sku snapshot found under output/');

  const snapshotPath = buildPublicTrafficPaths(outputDir, snapshotDate).sameSkuSnapshot;
  const snapshot = parseSnapshot(await readJson(snapshotPath));
  const { entries, overrides } = await loadRegistry(argv, outputDir);
  const report = buildLinkRegistryGroupReviewReport({
    entries,
    sameSkuGroupAliasRules: overrides?.sameSkuGroupAliasRules,
    snapshot,
  });
  const markdown = renderLinkRegistryGroupReviewMarkdown(report);
  const approvalCsv = renderLinkRegistryGroupReviewApprovalCsv(report);
  const approvalGuide = renderLinkRegistryGroupReviewApprovalGuide(report);
  const artifacts = await writeArtifacts(outputDir, snapshotDate, markdown, approvalCsv, approvalGuide, report);

  if (hasFlag(argv, '--json')) {
    console.log(JSON.stringify({ ...artifacts, report }, null, 2));
    return;
  }

  console.log('商品组审核单已生成');
  console.log(`- Markdown: ${artifacts.markdownPath}`);
  console.log(`- JSON: ${artifacts.jsonPath}`);
  console.log(`- Approval CSV: ${artifacts.approvalCsvPath}`);
  console.log(`- Approval Guide: ${artifacts.approvalGuidePath}`);
  console.log(`- 同款组: ${report.summary.totalGroups}`);
  console.log(`- 命名待审核: ${report.namingReviewGroups.length}`);
  console.log(`- 同名组桶: ${report.duplicateNameGroups.length}`);
  console.log(`- 样本不足组: ${report.sampleInsufficientGroups.length}`);
  console.log(`- 未归组链接: ${report.summary.ungroupedEntries}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLinkRegistryGroupReviewCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
