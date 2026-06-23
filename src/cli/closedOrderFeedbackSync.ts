import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { loadEnv, type MutableEnv } from '../config/loadEnv.js';
import { syncClosedOrderFeedbackFromApi, writeClosedOrderSyncArtifact } from '../closedOrderFeedback/sync.js';

function readArg(argv: string[], name: string): string | undefined {
  const flagIndex = argv.indexOf(name);
  if (flagIndex >= 0) return argv[flagIndex + 1];
  return argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function runClosedOrderFeedbackSyncCli(
  argv = process.argv.slice(2),
  env: MutableEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await loadEnv('.env', env);

  const limit = Number(readArg(argv, '--limit') ?? '20');
  if (!Number.isInteger(limit) || limit <= 0) throw new Error(`Invalid --limit: ${limit}`);

  const date = readArg(argv, '--date') ?? today();
  const ingestStatePath = readArg(argv, '--ingest-state') ?? 'output/state/closed-order-feedback-ingest.json';
  const outDir = readArg(argv, '--out-dir') ?? 'output/closed-order-feedback-sync';
  const result = await syncClosedOrderFeedbackFromApi(ingestStatePath, env, limit, fetchImpl);
  const artifactPath = join(outDir, `closed-order-feedback-sync-${date}.json`);
  await writeClosedOrderSyncArtifact(artifactPath, {
    date,
    generatedAt: new Date().toISOString(),
    fetchedCount: result.fetchedCount,
    addedCount: result.addedCount,
    updatedCount: result.updatedCount,
    totalCount: result.totalCount,
  });
  console.log(`关单同步已完成: ${artifactPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runClosedOrderFeedbackSyncCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
