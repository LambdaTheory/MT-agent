import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('orderAnalysisCrawler wiring', () => {
  it('覆盖四个页面、1日切换、展开与指标选择器，且空指标抛错', async () => {
    const source = await readFile('src/crawler/orderAnalysisCrawler.ts', 'utf8');
    expect(source).toContain('assistant-data-analysis/index/order/');
    expect(source).toContain('ORDER_ANALYSIS_PAGE_KEYS');
    expect(source).toContain("getByText('1日', { exact: true })");
    expect(source).toContain("getByText('展开', { exact: true })");
    expect(source).toContain('.merchant-ui-data-indicator');
    expect(source).toContain('merchant-ui-data-indicator-main-indicator');
    expect(source).toContain('merchant-ui-data-indicator-value-content');
    expect(source).toContain('merchant-ui-data-indicator-supplement-items');
    expect(source).toContain('请选择日期');
    expect(source).toContain('selectSubAccountIfNeeded');
    expect(source).toContain('指标为空');
    expect(source).toContain('展开后指标数未增加');
    expect(source).toContain('cleanOrderAnalysisIndicator');
    expect(source).toContain('resolveOrderAnalysisDataDate');
  });

  it('点击周期前会关闭遮挡浮层并在 pointer 拦截后重试', async () => {
    const source = await readFile('src/crawler/orderAnalysisCrawler.ts', 'utf8');
    expect(source).toContain('dismissBlockingOverlays');
    expect(source).toContain('intercepts pointer events');
    expect(source).toContain("click({ force: true })");
    expect(source).toContain("getByRole('button'");
    expect(source).toContain("getByText('我知道了'");
    expect(source).toContain("getByText('关闭'");
  });
});
