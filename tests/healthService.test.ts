import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildHealthReportCard, checkHealth, formatHealthReportMarkdown } from '../src/health/healthService.js';

async function writeConfig(root: string, outputDir: string): Promise<string> {
  const configPath = join(root, 'agent.config.json');
  await writeFile(configPath, JSON.stringify({
    targetUrl: 'https://example.test/dashboard',
    periods: ['1d', '7d', '30d'],
    preferredPageSize: 100,
    outputDir,
    browserProfileDir: 'profile',
  }), 'utf8');
  return configPath;
}

describe('health service', () => {
  it('aggregates shallow read-only health checks into a warn report when optional state is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mt-health-'));
    const outputDir = join(root, 'output');
    await mkdir(join(outputDir, '2026-07-22'), { recursive: true });
    await writeFile(join(outputDir, '2026-07-22', '公域数据上下文_2026-07-22.json'), JSON.stringify({ date: '2026-07-22' }), 'utf8');
    const configPath = await writeConfig(root, outputDir);

    const report = await checkHealth({
      configPath,
      now: () => new Date('2026-07-22T08:00:00.000Z'),
      rentalPriceClient: { daemonStatus: async () => ({ ok: true, status: 'ok', pong: true, lines: ['ping: ok', 'pong: true'] }) },
    });

    expect(report.status).toBe('warn');
    expect(report.outputDir).toBe(outputDir);
    expect(report.checks.find((check) => check.name === 'config')).toMatchObject({ status: 'ok' });
    expect(report.checks.find((check) => check.name === 'latest_report')).toMatchObject({ status: 'ok', summary: '最新日报 2026-07-22' });
    expect(report.checks.find((check) => check.name === 'rental_daemon')).toMatchObject({ status: 'ok' });
    expect(report.checks.find((check) => check.name === 'state_files')).toMatchObject({ status: 'warn' });
  });

  it('renders a Feishu health card with semantic status and no action buttons', async () => {
    const report = {
      status: 'fail' as const,
      checkedAt: '2026-07-22T08:00:00.000Z',
      outputDir: 'output',
      checks: [{ name: 'config', status: 'fail' as const, summary: '配置文件读取失败', detail: 'missing' }],
    };

    const markdown = formatHealthReportMarkdown(report);
    const card = buildHealthReportCard(report);
    const serialized = JSON.stringify(card);

    expect(markdown).toContain('整体状态');
    expect(markdown).toContain('配置文件读取失败');
    expect(card.header).toMatchObject({ template: 'red' });
    expect(serialized).toContain('/health 系统健康检查');
    expect(serialized).not.toContain('agent_tool_confirm');
    expect(serialized).not.toContain('rental_price_confirm');
  });
});
