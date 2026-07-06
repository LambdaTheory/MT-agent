import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadClosedOrderRegistryContext } from '../closedOrderFeedback/runtime.js';
import {
  buildLinkRegistryAuditReviewApprovalResult,
  mergeLinkRegistryOverrides,
  readLinkRegistryAuditReviewApprovalMarkdown,
  renderLinkRegistryAuditReviewApprovalResultMarkdown,
} from '../linkRegistry/auditReviewApproval.js';
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

async function writeArtifacts(resultDir: string, result: ReturnType<typeof buildLinkRegistryAuditReviewApprovalResult>): Promise<{ jsonPath: string; markdownPath: string }> {
  await mkdir(resultDir, { recursive: true });
  const reportDate = result.sourceMarkdownPath.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? result.generatedAt.slice(0, 10);
  const jsonPath = join(resultDir, `link-registry-audit-review-approved-${reportDate}.json`);
  const markdownPath = join(resultDir, `link-registry-audit-review-approved-${reportDate}.md`);
  await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, `${renderLinkRegistryAuditReviewApprovalResultMarkdown(result)}\n`, 'utf8');
  return { jsonPath, markdownPath };
}

export async function runLinkRegistryApplyAuditReviewCli(argv = process.argv.slice(2)): Promise<void> {
  const markdownPath = readArg(argv, '--markdown') ?? 'output/latest/link-registry-audit/link-registry-audit-review-approval-2026-06-26.md';
  const overridesPath = readArg(argv, '--overrides') ?? 'config/link-registry-overrides.json';
  const artifactDir = readArg(argv, '--artifact-dir') ?? 'output/latest/link-registry-audit';

  const ctx = await loadClosedOrderRegistryContext({}, process.cwd());
  const rows = await readLinkRegistryAuditReviewApprovalMarkdown(markdownPath);
  const result = buildLinkRegistryAuditReviewApprovalResult(markdownPath, rows, ctx.registry);
  await mergeOverridesSerialized(overridesPath, result.overrides);
  const artifacts = await writeArtifacts(artifactDir, result);

  console.log('链接档案审计审批已落地');
  console.log(`- Overrides: ${overridesPath}`);
  console.log(`- JSON: ${artifacts.jsonPath}`);
  console.log(`- Markdown: ${artifacts.markdownPath}`);
  console.log(`- Changed rows: ${result.summary.changedRows}`);
  console.log(`- Applied rows: ${result.summary.appliedRows}`);
  console.log(`- Ignored rows: ${result.summary.ignoredRows}`);
  console.log(`- Skipped rows: ${result.summary.skippedRows}`);
  console.log(`- Entry overrides: ${result.summary.entryOverrideCount}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLinkRegistryApplyAuditReviewCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
