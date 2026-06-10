import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config/loadConfig.js';
import { downloadGoodsExport } from '../crawler/goodsExportCrawler.js';
import { writeProductIdMappingFromExport } from '../mapping/refreshProductIdMapping.js';

export async function runRefreshProductIdMapCli(): Promise<void> {
  const config = await loadConfig();
  const exportPath = await downloadGoodsExport(config, 'output/latest/goods-export.xlsx');
  const mappingPath = config.productIdMappingPath ?? 'config/product-id-map.json';
  const logPath = 'output/latest/product-id-map-sync.log';
  const mappingCount = await writeProductIdMappingFromExport(exportPath, mappingPath, logPath);

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
