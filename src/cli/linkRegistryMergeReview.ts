import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadClosedOrderRegistryContext } from '../closedOrderFeedback/runtime.js';
import {
  buildLinkRegistryMergeReviewReport,
  renderLinkRegistryMergeReviewCsv,
  renderLinkRegistryMergeReviewGuide,
  renderLinkRegistryMergeReviewMarkdown,
} from '../linkRegistry/mergeReview.js';

function readArg(argv: string[], name: string): string | undefined {
  const flagIndex = argv.indexOf(name);
  if (flagIndex >= 0) return argv[flagIndex + 1];
  return argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

export async function runLinkRegistryMergeReviewCli(argv = process.argv.slice(2)): Promise<void> {
  const outputDir = readArg(argv, '--output-dir') ?? 'output/latest/link-registry-group-review';
  const ctx = await loadClosedOrderRegistryContext();
  const report = buildLinkRegistryMergeReviewReport(ctx.registry);
  await mkdir(outputDir, { recursive: true });
  const date = report.generatedAt.slice(0, 10);
  const markdownPath = join(outputDir, `link-registry-merge-review-${date}.md`);
  const csvPath = join(outputDir, `link-registry-merge-review-${date}.csv`);
  const jsonPath = join(outputDir, `link-registry-merge-review-${date}.json`);
  const guidePath = join(outputDir, `link-registry-merge-review-guide-${date}.md`);
  await writeFile(markdownPath, `${renderLinkRegistryMergeReviewMarkdown(report)}\n`, 'utf8');
  await writeFile(csvPath, renderLinkRegistryMergeReviewCsv(report), 'utf8');
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(guidePath, `${renderLinkRegistryMergeReviewGuide()}\n`, 'utf8');

  console.log('建议合并组清单已生成');
  console.log(`- Markdown: ${markdownPath}`);
  console.log(`- CSV: ${csvPath}`);
  console.log(`- JSON: ${jsonPath}`);
  console.log(`- Guide: ${guidePath}`);
  console.log(`- Candidate buckets: ${report.summary.candidateBuckets}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLinkRegistryMergeReviewCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
