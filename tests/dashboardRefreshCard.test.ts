import { describe, expect, it } from 'vitest';
import {
  buildDashboardRefreshResultCard,
  formatDashboardRefreshResultText,
} from '../src/feishuBot/dashboardRefreshCard.js';
import type { DashboardRefreshResult } from '../src/publicTraffic/dashboardRefresh.js';

const REPAIRED_TITLE = '\u8bbf\u95ee\u9875\u8865\u6293\u5e76\u91cd\u5efa\u5b8c\u6210';
const STILL_MISSING_TITLE = '\u8bbf\u95ee\u9875\u8865\u6293\u5b8c\u6210\uff0c\u4f46\u6570\u636e\u4ecd\u672a\u5b8c\u6574';
const SAVED_TITLE = '\u8bbf\u95ee\u9875\u6570\u636e\u5df2\u4fdd\u5b58';
const HISTORICAL_TITLE = '\u5386\u53f2\u8bbf\u95ee\u9875 raw \u5df2\u5f52\u6863';
const NOT_REBUILT_OR_RESENT = '\u65e5\u62a5\u5904\u7406\uff1a\u672a\u91cd\u5efa\u3001\u672a\u91cd\u53d1';

function result(status: DashboardRefreshResult['status']): DashboardRefreshResult {
  return {
    status,
    dataDate: '2026-06-24',
    actualPageDate: '2026-06-24',
    resolvedReportRunDate: '2026-06-25',
    firstQuality: { hasMissing: true, notes: [], periods: { '1d': { complete: true, rowCount: 12 }, '7d': { complete: false, rowCount: 0, reason: 'rowCount=0' }, '30d': { complete: true, rowCount: 30 } } },
    refreshQuality: { hasMissing: status === 'still_missing', notes: [], periods: { '1d': { complete: true, rowCount: 12 }, '7d': status === 'still_missing' ? { complete: false, rowCount: 0, reason: 'rowCount=0' } : { complete: true, rowCount: 70 }, '30d': { complete: true, rowCount: 300 } } },
    rebuild: status === 'repaired' ? 'performed' : 'skipped',
    resend: status === 'repaired' ? 'performed' : 'skipped',
    rawLocation: 'output/2026-06-25',
    refreshQualityText: 'fixture quality',
    message: 'fixture message',
  };
}

describe('dashboard refresh result cards', () => {
  it('uses the exact repaired title and green template', () => {
    expect(buildDashboardRefreshResultCard(result('repaired')).header).toMatchObject({ title: { content: REPAIRED_TITLE }, template: 'green' });
  });

  it('renders still-missing outcomes as orange with missing reasons and no rebuild or resend', () => {
    const card = buildDashboardRefreshResultCard(result('still_missing'));
    const rendered = JSON.stringify(card);
    expect(rendered).toContain(STILL_MISSING_TITLE);
    expect(card.header).toMatchObject({ template: 'orange' });
    expect(rendered).toContain('rowCount=0');
    expect(rendered).toContain(NOT_REBUILT_OR_RESENT);
    expect(rendered).not.toContain('\"tag\":\"button\"');
  });

  it('maps saved existing outcomes to blue saved-data cards with a layered layout', () => {
    for (const status of ['saved_existing_complete', 'saved_already_resent'] as const) {
      const card = buildDashboardRefreshResultCard(result(status));
      expect(card.header).toMatchObject({ title: { content: SAVED_TITLE }, template: 'blue' });
      expect((card.body as { elements: unknown[] }).elements).toHaveLength(4);
      expect(JSON.stringify(card)).toContain('\u4e1a\u52a1\u6570\u636e\u65e5');
      expect(JSON.stringify(card)).toContain('\u4e09\u5468\u671f\u8d28\u91cf');
      expect(JSON.stringify(card)).toContain('raw \u53bb\u5411');
    }
    expect(JSON.stringify(buildDashboardRefreshResultCard(result('saved_already_resent')))).toContain('\u65e5\u62a5\u5904\u7406\uff1a\u5df2\u8df3\u8fc7\u91cd\u590d\u91cd\u53d1');
  });

  it('maps a no-report archive to the exact blue historical title', () => {
    expect(buildDashboardRefreshResultCard(result('saved_historical_without_report')).header).toMatchObject({ title: { content: HISTORICAL_TITLE }, template: 'blue' });
  });

  it('includes data dates, every period status and count, raw location, and the same facts in text', () => {
    const refresh = result('still_missing');
    const rendered = JSON.stringify(buildDashboardRefreshResultCard(refresh));
    const text = formatDashboardRefreshResultText(refresh);
    for (const value of ['2026-06-24', '1日', '7日', '30日', '12', '0', '300', 'output/2026-06-25']) {
      expect(rendered).toContain(value);
      expect(text).toContain(value);
    }
    expect(text).toContain(NOT_REBUILT_OR_RESENT);
    expect(text).toContain('rowCount=0');
    expect(text).not.toContain('Agent 操作已完成');
  });

  it('shows rebuild without resend as a blue saved-data card', () => {
    const refresh = { ...result('saved_existing_complete'), rebuild: 'performed' as const, resend: 'skipped' as const, message: '\u5df2\u8865\u6293\u5b8c\u6574\u8bbf\u95ee\u9875 raw \u5e76\u91cd\u5efa\u65e5\u62a5\uff0c\u4f46\u98de\u4e66\u91cd\u53d1\u5931\u8d25\uff1amissing config' };
    const card = buildDashboardRefreshResultCard(refresh);
    const rendered = JSON.stringify(card);

    expect(card.header).toMatchObject({ title: { content: SAVED_TITLE }, template: 'blue' });
    expect(rendered).toContain('\u65e5\u62a5\u5904\u7406\uff1a\u5df2\u91cd\u5efa\uff0c\u672a\u91cd\u53d1');
    expect(rendered).toContain('\u91cd\u53d1\u5931\u8d25');
    expect(rendered).not.toContain('\u65e5\u62a5\u5904\u7406\uff1a\u5df2\u91cd\u5efa\uff0c\u5df2\u91cd\u53d1 1 \u6b21');
  });
});
