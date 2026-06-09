import { access, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config/loadConfig.js';
import { downloadGoodsExport } from '../crawler/goodsExportCrawler.js';
import { parseGoodsExportMapping } from '../mapping/goodsExportMapping.js';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeMappingFromExport(exportPath: string, mappingPath: string, logPath: string): Promise<number> {
  const result = parseGoodsExportMapping(exportPath);
  const mappingCount = Object.keys(result.mapping).length;

  if (mappingCount < 50) {
    throw new Error(`Refusing to write product ID mapping: only ${mappingCount} mappings parsed from ${exportPath}`);
  }

  await mkdir(dirname(mappingPath), { recursive: true });
  await mkdir(dirname(logPath), { recursive: true });

  if (await exists(mappingPath)) {
    await copyFile(mappingPath, mappingPath.replace(/\.json$/, '.backup.json'));
  }

  await writeFile(mappingPath, `${JSON.stringify(result.mapping, null, 2)}\n`, 'utf8');

  const log = [
    `source=${exportPath}`,
    `mappingPath=${mappingPath}`,
    `mappingCount=${mappingCount}`,
    `skippedRows=${result.skippedRows.length}`,
    ...result.skippedRows.map((row) => `skip row=${row.rowNumber} platformProductId=${row.platformProductId} merchantCode=${row.merchantCode} reason=${row.reason}`),
    '',
  ].join('\n');
  await writeFile(logPath, log, 'utf8');

  return mappingCount;
}

export async function runRefreshProductIdMapCli(): Promise<void> {
  const config = await loadConfig();
  const exportPath = await downloadGoodsExport(config, 'output/latest/goods-export.xlsx');
  const mappingPath = config.productIdMappingPath ?? 'config/product-id-map.json';
  const logPath = 'output/latest/product-id-map-sync.log';
  const mappingCount = await writeMappingFromExport(exportPath, mappingPath, logPath);

  console.log(`Downloaded goods export to ${exportPath}`);
  console.log(`Wrote ${mappingCount} product ID mappings to ${mappingPath}`);
  console.log(`Wrote sync log to ${logPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRefreshProductIdMapCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
