import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadClosedOrderIngestState } from '../closedOrderFeedback/ingest.js';
import { buildClosedOrderObservationReport, writeClosedOrderObservationReportArtifacts } from '../closedOrderFeedback/observation.js';
import { loadClosedOrderRegistryContext } from '../closedOrderFeedback/runtime.js';
import { loadEnv } from '../config/loadEnv.js';

function readArg(argv: string[], name: string): string | undefined {
  const flagIndex = argv.indexOf(name);
  if (flagIndex >= 0) return argv[flagIndex + 1];
  return argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function runClosedOrderObservationReportCli(argv = process.argv.slice(2)): Promise<void> {
  await loadEnv();

  const reportDate = readArg(argv, '--date') ?? today();
  const windowDays = Number(readArg(argv, '--window-days') ?? '7');
  if (!Number.isInteger(windowDays) || windowDays <= 0) throw new Error(`Invalid --window-days: ${windowDays}`);

  const outDir = readArg(argv, '--out-dir') ?? 'output/closed-order-observation';
  const ingestStatePath = readArg(argv, '--ingest-state') ?? 'output/state/closed-order-feedback-ingest.json';
  const productIdMapPath = readArg(argv, '--product-id-map') ?? 'config/product-id-map.json';
  const productNameMapPath = readArg(argv, '--product-name-map') ?? 'config/product-name-map.json';
  const firstSeenPath = readArg(argv, '--first-seen-state') ?? 'output/state/goods-first-seen.json';
  const lifecyclePath = readArg(argv, '--link-lifecycle-state') ?? 'output/state/goods-link-lifecycle.json';
  const artifactsDir = readArg(argv, '--artifacts-dir') ?? 'output';

  const [state, registryContext] = await Promise.all([
    loadClosedOrderIngestState(ingestStatePath),
    loadClosedOrderRegistryContext({
      productIdMapPath,
      productNameMapPath,
      firstSeenPath,
      lifecyclePath,
      artifactsDir,
    }),
  ]);

  const report = await buildClosedOrderObservationReport(state.items, registryContext.query, { reportDate, windowDays });
  const baseName = `closed-order-observation-${reportDate}`;
  const jsonPath = join(outDir, `${baseName}.json`);
  const markdownPath = join(outDir, `${baseName}.md`);
  await writeClosedOrderObservationReportArtifacts(jsonPath, markdownPath, report);
  console.log(`关单观察报告已生成: ${markdownPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runClosedOrderObservationReportCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
