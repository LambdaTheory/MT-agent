import { access, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseGoodsExportMapping, type GoodsExportMappingResult } from './goodsExportMapping.js';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface WriteProductIdMappingResultInput {
  exportPath: string;
  mappingPath: string;
  logPath: string;
  result: GoodsExportMappingResult;
}

export async function writeProductIdMappingResult(input: WriteProductIdMappingResultInput): Promise<number> {
  const mappingCount = Object.keys(input.result.mapping).length;

  if (mappingCount < 50) {
    throw new Error(`Refusing to write product ID mapping: only ${mappingCount} mappings parsed from ${input.exportPath}`);
  }

  await mkdir(dirname(input.mappingPath), { recursive: true });
  await mkdir(dirname(input.logPath), { recursive: true });

  if (await exists(input.mappingPath)) {
    await copyFile(input.mappingPath, input.mappingPath.replace(/\.json$/, '.backup.json'));
  }

  await writeFile(input.mappingPath, `${JSON.stringify(input.result.mapping, null, 2)}\n`, 'utf8');

  const log = [
    `source=${input.exportPath}`,
    `mappingPath=${input.mappingPath}`,
    `mappingCount=${mappingCount}`,
    `skippedRows=${input.result.skippedRows.length}`,
    ...input.result.skippedRows.map((row) => `skip row=${row.rowNumber} platformProductId=${row.platformProductId} merchantCode=${row.merchantCode} reason=${row.reason}`),
    '',
  ].join('\n');
  await writeFile(input.logPath, log, 'utf8');

  return mappingCount;
}

export async function writeProductIdMappingFromExport(exportPath: string, mappingPath: string, logPath: string): Promise<number> {
  return writeProductIdMappingResult({ exportPath, mappingPath, logPath, result: parseGoodsExportMapping(exportPath) });
}
