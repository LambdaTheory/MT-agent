import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildLinkRegistryMergeReviewApprovalResult,
  mergeLinkRegistryOverrides,
  readLinkRegistryMergeReviewApprovalCsv,
  renderLinkRegistryMergeReviewApprovalResultMarkdown,
} from '../linkRegistry/mergeReviewApproval.js';
import { parseLinkRegistryOverrides, type LinkRegistryOverrides } from '../linkRegistry/overrides.js';
import { mutateJsonFileSerialized } from '../linkRegistry/persistence.js';

function readArg(argv: string[], name: string): string | undefined {
  const flagIndex = argv.indexOf(name);
  if (flagIndex >= 0) return argv[flagIndex + 1];
  return argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

function stripPreviousMergeReviewOverrides(overrides: LinkRegistryOverrides | null): LinkRegistryOverrides | null {
  if (!overrides?.entries) return overrides;
  return {
    ...overrides,
    entries: overrides.entries.filter((entry) => entry.reason !== 'link_registry_merge_review_approval'),
  };
}

async function mergeOverridesSerialized(path: string, patch: LinkRegistryOverrides): Promise<void> {
  await mutateJsonFileSerialized<unknown>(path, { version: 1 }, (current) => {
    const existingOverrides = stripPreviousMergeReviewOverrides(parseLinkRegistryOverrides(current));
    return mergeLinkRegistryOverrides(existingOverrides, patch);
  });
}

async function writeArtifacts(resultDir: string, result: ReturnType<typeof buildLinkRegistryMergeReviewApprovalResult>): Promise<{ jsonPath: string; markdownPath: string }> {
  await mkdir(resultDir, { recursive: true });
  const reportDate = result.sourceCsvPath.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? result.generatedAt.slice(0, 10);
  const jsonPath = join(resultDir, `link-registry-merge-review-approved-${reportDate}.json`);
  const markdownPath = join(resultDir, `link-registry-merge-review-approved-${reportDate}.md`);
  await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, `${renderLinkRegistryMergeReviewApprovalResultMarkdown(result)}\n`, 'utf8');
  return { jsonPath, markdownPath };
}

export async function runLinkRegistryApplyMergeReviewCli(argv = process.argv.slice(2)): Promise<void> {
  const csvPath = readArg(argv, '--csv') ?? 'output/latest/link-registry-group-review/link-registry-merge-review-2026-06-26.csv';
  const overridesPath = readArg(argv, '--overrides') ?? 'config/link-registry-overrides.json';
  const artifactDir = readArg(argv, '--artifact-dir') ?? 'output/latest/link-registry-group-review';

  const rows = await readLinkRegistryMergeReviewApprovalCsv(csvPath);
  const result = buildLinkRegistryMergeReviewApprovalResult(csvPath, rows);
  await mergeOverridesSerialized(overridesPath, result.overrides);
  const artifacts = await writeArtifacts(artifactDir, result);

  console.log('建议合并组审批结果已落地');
  console.log(`- Overrides: ${overridesPath}`);
  console.log(`- JSON: ${artifacts.jsonPath}`);
  console.log(`- Markdown: ${artifacts.markdownPath}`);
  console.log(`- Changed rows: ${result.summary.changedRows}`);
  console.log(`- Applied rows: ${result.summary.appliedRows}`);
  console.log(`- Anchor rows: ${result.summary.anchorRows}`);
  console.log(`- Entry overrides: ${result.summary.entryOverrideCount}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLinkRegistryApplyMergeReviewCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
