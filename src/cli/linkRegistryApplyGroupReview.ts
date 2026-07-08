import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildLinkRegistryGroupReviewApprovalResult,
  mergeLinkRegistryOverrides,
  readLinkRegistryGroupReviewApprovalCsv,
  renderLinkRegistryGroupReviewApprovalResultMarkdown,
} from '../linkRegistry/groupReviewApproval.js';
import { parseLinkRegistryOverrides, type LinkRegistryOverrides } from '../linkRegistry/overrides.js';
import { mutateJsonFileSerialized } from '../linkRegistry/persistence.js';

function readArg(argv: string[], name: string): string | undefined {
  const flagIndex = argv.indexOf(name);
  if (flagIndex >= 0) return argv[flagIndex + 1];
  return argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

async function mergeOverridesSerialized(path: string, patch: LinkRegistryOverrides): Promise<void> {
  await mutateJsonFileSerialized<unknown>(path, { version: 1 }, (current) => mergeLinkRegistryOverrides(parseLinkRegistryOverrides(current), patch));
}

async function writeArtifacts(resultDir: string, result: ReturnType<typeof buildLinkRegistryGroupReviewApprovalResult>): Promise<{ jsonPath: string; markdownPath: string }> {
  await mkdir(resultDir, { recursive: true });
  const reportDate = result.sourceCsvPath.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? result.generatedAt.slice(0, 10);
  const jsonPath = join(resultDir, `link-registry-group-review-approved-${reportDate}.json`);
  const markdownPath = join(resultDir, `link-registry-group-review-approved-${reportDate}.md`);
  await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, `${renderLinkRegistryGroupReviewApprovalResultMarkdown(result)}\n`, 'utf8');
  return { jsonPath, markdownPath };
}

export async function runLinkRegistryApplyGroupReviewCli(argv = process.argv.slice(2)): Promise<void> {
  const csvPath = readArg(argv, '--csv') ?? 'output/latest/link-registry-group-review/link-registry-group-review-approval-2026-06-26.csv';
  const overridesPath = readArg(argv, '--overrides') ?? 'config/link-registry-overrides.json';
  const artifactDir = readArg(argv, '--artifact-dir') ?? 'output/latest/link-registry-group-review';

  const rows = await readLinkRegistryGroupReviewApprovalCsv(csvPath);
  const result = buildLinkRegistryGroupReviewApprovalResult(csvPath, rows);
  await mergeOverridesSerialized(overridesPath, result.overrides);
  const artifacts = await writeArtifacts(artifactDir, result);

  console.log('商品组审批结果已落地');
  console.log(`- Overrides: ${overridesPath}`);
  console.log(`- JSON: ${artifacts.jsonPath}`);
  console.log(`- Markdown: ${artifacts.markdownPath}`);
  console.log(`- Changed rows: ${result.summary.changedRows}`);
  console.log(`- Applied rows: ${result.summary.appliedRows}`);
  console.log(`- Entry overrides: ${result.summary.entryOverrideCount}`);
  console.log(`- Duplicate short-name buckets: ${result.summary.duplicateShortNameBuckets}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLinkRegistryApplyGroupReviewCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
