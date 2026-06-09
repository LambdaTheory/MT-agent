import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config/loadConfig.js';
import { buildPublicTrafficFeishuText } from '../publicTraffic/buildPublicTrafficFeishu.js';
import { buildPublicTrafficMarkdown } from '../publicTraffic/buildPublicTrafficMarkdown.js';
import { writePublicTrafficWorkbookBuffer } from '../publicTraffic/buildPublicTrafficWorkbook.js';
import { buildPublicTrafficPaths } from '../publicTraffic/paths.js';
import type { PublicTrafficReportContext } from '../publicTraffic/types.js';
import { createRunLog } from '../storage/runLog.js';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function runPublicTrafficReportCli(): Promise<void> {
  const config = await loadConfig();
  const date = today();
  const paths = buildPublicTrafficPaths(config.outputDir, date);
  const log = createRunLog(new Date().toISOString(), config.targetUrl);

  await mkdir(paths.dir, { recursive: true });

  try {
    const context: PublicTrafficReportContext = {
      date,
      overview: [],
      exposureOptimization: [],
      conversionOptimization: [],
      newProductObservation: [],
      lifecycleGovernance: [],
    };

    await writeFile(paths.reportContext, JSON.stringify(context, null, 2), 'utf8');
    await writeFile(paths.markdown, buildPublicTrafficMarkdown(context), 'utf8');
    await writeFile(paths.workbook, writePublicTrafficWorkbookBuffer(context));
    log.addEvent(`Wrote report context: ${paths.reportContext}`);
    log.addEvent(`Wrote markdown: ${paths.markdown}`);
    log.addEvent(`Wrote workbook: ${paths.workbook}`);

    const feishuText = buildPublicTrafficFeishuText(context, {
      markdownPath: paths.markdown,
      workbookPath: paths.workbook,
    });
    console.log(feishuText);

    console.log(`Wrote public traffic report skeleton to ${paths.dir}`);
  } catch (error) {
    log.addEvent(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  } finally {
    await writeFile(paths.log, log.toText(), 'utf8');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPublicTrafficReportCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
