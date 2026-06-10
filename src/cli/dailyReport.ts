import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { analyzeProducts } from '../analyzer/analyzeProducts.js';
import { loadConfig } from '../config/loadConfig.js';
import { loadEnv } from '../config/loadEnv.js';
import { crawlDashboard } from '../crawler/dashboardCrawler.js';
import { normalizeRowsForPeriod } from '../extractor/normalizeRows.js';
import { enrichAnalysisRowsWithMapping } from '../mapping/enrichAnalysisRows.js';
import { maybeSendFeishuReport } from '../notify/feishu.js';
import { buildMarkdownReport } from '../report/buildMarkdown.js';
import { writeWorkbookBuffer } from '../report/buildWorkbook.js';
import { buildOutputPaths } from '../storage/outputPaths.js';
import { createRunLog } from '../storage/runLog.js';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function runDailyReportCli(): Promise<void> {
  await loadEnv();
  const config = await loadConfig();
  const date = today();
  const paths = buildOutputPaths(config.outputDir, date);
  const log = createRunLog(new Date().toISOString(), config.targetUrl);

  await mkdir(paths.dir, { recursive: true });

  try {
    log.addEvent('Starting dashboard crawl');

    const rawTables = await crawlDashboard(config);

    for (const table of rawTables) {
      log.addPeriodStats(table.collection);
      await writeFile(paths.raw[table.period], JSON.stringify(table, null, 2), 'utf8');
    }

    const metrics = rawTables.flatMap(normalizeRowsForPeriod);
    const analysisRows = await enrichAnalysisRowsWithMapping(analyzeProducts(metrics), config.productIdMappingPath);
    const report = {
      date,
      rawTables,
      analysisRows,
      incomplete: rawTables.some((table) => !table.collection.complete),
    };

    await writeFile(paths.workbook, writeWorkbookBuffer(report));
    await writeFile(paths.markdown, buildMarkdownReport(report), 'utf8');
    log.addEvent(`Wrote workbook: ${paths.workbook}`);
    log.addEvent(`Wrote markdown: ${paths.markdown}`);

    const feishuResult = await maybeSendFeishuReport(report, {
      markdownPath: paths.markdown,
      workbookPath: paths.workbook,
    });
    log.addEvent(feishuResult.sent ? 'Sent Feishu notification' : `Skipped Feishu notification: ${feishuResult.reason}`);
  } catch (error) {
    log.addEvent(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  } finally {
    await writeFile(paths.log, log.toText(), 'utf8');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDailyReportCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
