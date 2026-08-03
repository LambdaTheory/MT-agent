import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config/loadConfig.js';
import { ensureAuthenticatedMerchantSession } from '../crawler/merchantSession.js';
import { shouldKeepBrowserOpenOnFailure } from '../crawler/failureHandling.js';
import { JsonCustodyConflictAuditWriter, PlaywrightCustodyConflictAdapter, runCustodyConflictCleanup } from '../custodyConflictCleanup/index.js';

export type CustodyConflictCleanupCliOptions = { execute: false };

const HELP_TEXT = [
  'Usage: npm run custody-conflict-cleanup',
  '',
  'Preview-only: scans Alipay custody conflicts and writes an audit JSON without cancelling custody.',
  'Real cancellation is intentionally unavailable from this CLI and must enter through an explicit 飞书确认卡 path.',
].join('\n');

export function parseCustodyConflictCleanupCliOptions(argv: string[]): CustodyConflictCleanupCliOptions {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { execute: false };
  }
  if (argv.length > 0) {
    throw new Error(`custody-conflict-cleanup is preview-only; real cancellation requires an explicit 飞书确认卡 path. Unsupported args: ${argv.join(' ')}`);
  }
  return { execute: false };
}

export async function runCustodyConflictCleanupCli(argv = process.argv.slice(2)): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP_TEXT);
    return;
  }

  parseCustodyConflictCleanupCliOptions(argv);
  const config = await loadConfig();
  const auditWriter = await JsonCustodyConflictAuditWriter.create(config.outputDir);
  const { browser, page } = await ensureAuthenticatedMerchantSession(config, { acceptDownloads: false, stage: 'custody-conflict-cleanup' });
  let completed = false;

  try {
    const result = await runCustodyConflictCleanup({
      adapter: new PlaywrightCustodyConflictAdapter(page, config.exposureUrl),
      auditWriter,
      execute: false,
    });
    completed = true;
    console.log([
      '支付宝托管冲突清理预览完成，未执行取消托管。',
      `扫描页次: ${result.pagesVisited}`,
      `发现冲突候选: ${result.candidatesFound}`,
      `已取消托管: ${result.cancelledCount}`,
      `审计文件: ${result.auditPath}`,
    ].join('\n'));
  } finally {
    if (completed || !shouldKeepBrowserOpenOnFailure(process.env.MT_AGENT_KEEP_BROWSER_ON_FAILURE)) {
      await browser.close();
    } else {
      console.error('托管冲突清理失败；保留浏览器窗口供检查。');
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCustodyConflictCleanupCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
