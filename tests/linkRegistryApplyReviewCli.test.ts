import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runLinkRegistryApplyGroupReviewCli } from '../src/cli/linkRegistryApplyGroupReview.js';
import { runLinkRegistryApplyMergeReviewCli } from '../src/cli/linkRegistryApplyMergeReview.js';

describe('link registry apply review CLIs', () => {
  it('serializes concurrent override merges from apply commands', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'mt-agent-link-registry-apply-cli-'));
    const overridesPath = join(outputDir, 'config', 'link-registry-overrides.json');
    const groupCsvPath = join(outputDir, 'group', 'link-registry-group-review-approval-2026-06-26.csv');
    const mergeCsvPath = join(outputDir, 'merge', 'link-registry-merge-review-2026-06-26.csv');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await mkdir(join(outputDir, 'group'), { recursive: true });
    await mkdir(join(outputDir, 'merge'), { recursive: true });
    await writeFile(groupCsvPath, [
      '"priority","reviewReasons","sameSkuGroupId","currentDisplayName","suggestedShortName","decision","finalShortName","finalSameSkuGroupId","finalCategoryName","finalProductType","note","activeLinkCount","totalLinkCount","categoryName","productType","internalProductIds","aliases","risks"',
      '"P0","机器名待改","dji-pocket-3","dji-pocket-3","Pocket 3","","pocket3","","","","","65","65","","","530","dji-pocket-3",""',
    ].join('\n'), 'utf8');
    await writeFile(mergeCsvPath, [
      '"priority","shortName","suggestedTargetGroupId","candidateGroupId","activeLinkCount","totalLinkCount","internalProductIds","productNames","decision","finalTargetGroupId","note"',
      '"P0","r50","canon-r50-a","canon-r50-b","1","1","3","","accept","",""',
    ].join('\n'), 'utf8');

    await Promise.all([
      runLinkRegistryApplyGroupReviewCli(['--csv', groupCsvPath, '--overrides', overridesPath, '--artifact-dir', join(outputDir, 'group-artifacts')]),
      runLinkRegistryApplyMergeReviewCli(['--csv', mergeCsvPath, '--overrides', overridesPath, '--artifact-dir', join(outputDir, 'merge-artifacts')]),
    ]);

    const overrides = JSON.parse(await readFile(overridesPath, 'utf8')) as { entries: Array<{ internalProductId: string; shortName?: string; sameSkuGroupId?: string }> };
    expect(overrides.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ internalProductId: '530', shortName: 'pocket3' }),
      expect.objectContaining({ internalProductId: '3', sameSkuGroupId: 'canon-r50-a' }),
    ]));
  });
});
