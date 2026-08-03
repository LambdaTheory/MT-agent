import { pathToFileURL } from 'node:url';
import { loadEnv } from '../config/loadEnv.js';
import { prepareCustodyCleanupConfirmationCard } from '../custodyConflictCleanup/confirmationCard.js';
import { sendFeishuCard } from '../notify/feishu.js';

const HELP_TEXT = [
  'Usage: npm run custody-conflict-cleanup:confirm -- --audit <path>',
  '',
  'Imports a fresh preview-only custody cleanup audit, stores an immutable plan, and sends a Feishu confirmation card.',
  'This command does not cancel custody. Real cancellation only happens after an authorized Feishu card confirmation.',
].join('\n');

function parseAuditPath(argv: string[]): string {
  if (argv.includes('--help') || argv.includes('-h')) return '';
  const index = argv.indexOf('--audit');
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value) throw new Error('Missing required --audit <path>.');
  return value;
}

export async function runCustodyConflictCleanupConfirmCli(argv = process.argv.slice(2)): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP_TEXT);
    return;
  }

  const auditPath = parseAuditPath(argv);
  await loadEnv();
  if (!process.env.MT_AGENT_CUSTODY_CLEANUP_APPROVER_IDS?.trim()) {
    throw new Error('MT_AGENT_CUSTODY_CLEANUP_APPROVER_IDS is required before sending a custody cleanup confirmation card; empty config fails closed.');
  }
  const outputDir = process.env.MT_AGENT_OUTPUT_DIR ?? 'output';
  const result = await prepareCustodyCleanupConfirmationCard({ auditPath, outputDir });
  const delivery = await sendFeishuCard(process.env, result.card, [
    '支付宝托管冲突清理确认卡',
    `计划：${result.plan.planRef}`,
    `候选：${result.plan.candidates.length}`,
    `有效期至：${result.plan.expiresAt}`,
    '请在飞书交互卡片中确认，确认前不会执行取消托管。',
  ].join('\n'));

  if (!delivery.sent) throw new Error(`飞书确认卡发送失败：${delivery.reason}`);
  console.log([
    '支付宝托管冲突清理飞书确认卡已发送，当前未执行取消托管。',
    `计划：${result.plan.planRef}`,
    `候选：${result.plan.candidates.length}`,
    `有效期至：${result.plan.expiresAt}`,
    `计划文件：${result.planPath}`,
    `确认请求：${result.requestRef}`,
  ].join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCustodyConflictCleanupConfirmCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
