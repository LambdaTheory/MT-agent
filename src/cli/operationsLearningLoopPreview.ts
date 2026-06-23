import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildOperationsLearningQuizPreview } from '../operationsLearningLoop/quiz.js';
import { loadProductNameMap } from '../publicTraffic/productDisplayName.js';
import type { PublicTrafficDataReportContext } from '../publicTraffic/types.js';

function readArg(argv: string[], name: string): string | undefined {
  const flagIndex = argv.indexOf(name);
  if (flagIndex >= 0) return argv[flagIndex + 1];
  return argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

export async function runOperationsLearningLoopPreviewCli(argv = process.argv.slice(2)): Promise<void> {
  const contextPath = readArg(argv, '--context');
  if (!contextPath) throw new Error('Missing --context path');
  const outDir = readArg(argv, '--out-dir') ?? dirname(contextPath);
  const productNameMapPath = readArg(argv, '--product-name-map') ?? 'config/product-name-map.json';
  const context = JSON.parse(await readFile(contextPath, 'utf8')) as PublicTrafficDataReportContext;
  const productNameMap = await loadProductNameMap(productNameMapPath, (message) => console.warn(message));
  const preview = buildOperationsLearningQuizPreview(context, 10, productNameMap);
  await mkdir(outDir, { recursive: true });

  const baseName = `operations-learning-quiz-${preview.date}`;
  await writeFile(join(outDir, `${baseName}.json`), `${JSON.stringify({ date: preview.date, items: preview.items, card: preview.card, questionCard: preview.questionCard }, null, 2)}\n`, 'utf8');
  await writeFile(join(outDir, `${baseName}.md`), `${preview.markdown}\n`, 'utf8');
  console.log(`运营学习 loop 测验预览已生成: ${join(outDir, `${baseName}.md`)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runOperationsLearningLoopPreviewCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
