import { readFile, writeFile, mkdir } from 'node:fs/promises';
import type { RawTableData } from '../domain/types.js';
import { normalizeRowsForPeriod } from '../extractor/normalizeRows.js';
import { analyzeProducts } from '../analyzer/analyzeProducts.js';
import { loadConfig } from '../config/loadConfig.js';
import { enrichAnalysisRowsWithMapping } from '../mapping/enrichAnalysisRows.js';
import { buildMarkdownReport } from '../report/buildMarkdown.js';
import { writeWorkbookBuffer } from '../report/buildWorkbook.js';
import { buildOutputPaths } from '../storage/outputPaths.js';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function readRaw(path: string): Promise<RawTableData> {
  return JSON.parse(await readFile(path, 'utf8')) as RawTableData;
}

async function main(): Promise<void> {
  const date = today();
  const config = await loadConfig();
  const paths = buildOutputPaths(config.outputDir, date);
  await mkdir(paths.dir, { recursive: true });

  const rawTables = await Promise.all([
    readRaw('output/latest/raw-1d.json'),
    readRaw('output/latest/raw-7d.json'),
    readRaw('output/latest/raw-30d.json'),
  ]);
  const metrics = rawTables.flatMap(normalizeRowsForPeriod);
  const analysisRows = await enrichAnalysisRowsWithMapping(analyzeProducts(metrics), config.productIdMappingPath);
  const report = {
    date,
    rawTables,
    analysisRows,
    incomplete: rawTables.some((table) => !table.collection.complete),
  };

  const workbookBuffer = writeWorkbookBuffer(report);
  const markdown = buildMarkdownReport(report);

  try {
    await writeFile(paths.workbook, workbookBuffer);
    await writeFile(paths.markdown, markdown, 'utf8');
    console.log(`Rebuilt ${paths.workbook}`);
    console.log(`Rebuilt ${paths.markdown}`);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('EBUSY')) {
      throw error;
    }

    const fallbackWorkbook = paths.workbook.replace(/\.xlsx$/, '_rebuilt.xlsx');
    const fallbackMarkdown = paths.markdown.replace(/\.md$/, '_rebuilt.md');
    await writeFile(fallbackWorkbook, workbookBuffer);
    await writeFile(fallbackMarkdown, markdown, 'utf8');
    console.log(`Target report was locked. Rebuilt ${fallbackWorkbook}`);
    console.log(`Target report was locked. Rebuilt ${fallbackMarkdown}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
