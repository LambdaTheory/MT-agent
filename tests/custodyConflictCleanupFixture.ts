import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const custodyFixtureCompletedAt = '2026-07-31T07:23:09.275Z';

export async function writeCanonicalCustodyPreviewAudit(dir: string, candidateCount = 36, completedAt = custodyFixtureCompletedAt): Promise<string> {
  const path = join(dir, 'canonical-custody-preview-audit.json');
  const events: unknown[] = [
    { type: 'run_started', at: '2026-07-31T07:19:06.701Z', execute: false },
  ];

  for (let pageNumber = 1; pageNumber <= 39; pageNumber += 1) {
    const firstCandidateIndex = (pageNumber - 1) * 2;
    const remainingCandidates = Math.max(0, candidateCount - firstCandidateIndex);
    const conflictCount = Math.min(remainingCandidates, 2);
    events.push({
      type: 'page_scanned',
      at: `2026-07-31T07:20:${String(pageNumber).padStart(2, '0')}.000Z`,
      pageNumber,
      totalPages: 39,
      rowCount: 10,
      conflictCount,
      signature: `fixture-page-${pageNumber}`,
    });
    for (let offset = 0; offset < conflictCount; offset += 1) {
      const candidateNumber = firstCandidateIndex + offset + 1;
      const platformProductId = `2026073100216201000000${String(candidateNumber).padStart(6, '0')}`;
      events.push({
        type: 'candidate_previewed',
        at: `2026-07-31T07:20:${String(pageNumber).padStart(2, '0')}.${String(offset + 1).padStart(3, '0')}Z`,
        pageNumber,
        rowId: platformProductId,
        productName: `托管冲突测试商品 ${candidateNumber}`,
        platformProductId,
        productStatusLabel: '已下架',
        custodyStatusLabel: candidateNumber % 5 === 0 ? '托管异常 已托管 47天' : '托管中 已托管 47天',
        actionLabels: ['取消托管', '数据'],
      });
    }
  }

  events.push({ type: 'run_completed', at: completedAt, pagesVisited: 39, candidatesFound: candidateCount, cancelledCount: 0 });
  await writeFile(path, `${JSON.stringify({ runId: 'custody-fixture-run', createdAt: '2026-07-31T07:18:35.120Z', events }, null, 2)}\n`, 'utf8');
  return path;
}
