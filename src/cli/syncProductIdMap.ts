import { access, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config/loadConfig.js';
import { parseGoodsExportMapping } from '../mapping/goodsExportMapping.js';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function defaultExportPath(): string {
  return 'D:/Download/A_6xr4S7mNi2oAAAAAQXAAAAgAejcnAQ.xlsx';
}

export async function runSyncProductIdMapCli(): Promise<void> {
  const config = await loadConfig();
  const exportPath = process.argv[2] ?? defaultExportPath();
  const mappingPath = config.productIdMappingPath ?? 'config/product-id-map.json';
  const backupPath = mappingPath.replace(/\.json$/, '.backup.json');
  const logPath = 'output/latest/product-id-map-sync.log';
  const result = parseGoodsExportMapping(exportPath);
  const mappingCount = Object.keys(result.mapping).length;

  if (mappingCount < 50) {
    throw new Error(`Refusing to write product ID mapping: only ${mappingCount} mappings parsed from ${exportPath}`);
  }

  await mkdir(dirname(mappingPath), { recursive: true });
  await mkdir(dirname(logPath), { recursive: true });

  if (await exists(mappingPath)) {
    await copyFile(mappingPath, backupPath);
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
  console.log(`Wrote ${mappingCount} product ID mappings to ${mappingPath}`);
  console.log(`Wrote sync log to ${logPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSyncProductIdMapCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
