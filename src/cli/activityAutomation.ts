import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config/loadConfig.js';
import { activityAutomationConfigFromAgentConfig, createEmptyDifferentialPricingDraft, prepareActivityFormPage } from '../activityAutomation/index.js';

function readArgValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function validateDateFlag(value: string, flag: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid value for ${flag}: expected YYYY-MM-DD`);
  }
  return value;
}

export function parseActivityAutomationCliOptions(argv: string[]): { confirmSubmit: boolean; pickProducts: boolean; startsAt?: string; endsAt?: string } {
  const startsAt = readArgValue(argv, '--starts-at');
  const endsAt = readArgValue(argv, '--ends-at');
  if ((startsAt && !endsAt) || (!startsAt && endsAt)) {
    throw new Error('Both --starts-at and --ends-at are required together.');
  }

  return {
    confirmSubmit: argv.includes('--confirm-submit'),
    pickProducts: argv.includes('--pick-products'),
    startsAt: startsAt ? validateDateFlag(startsAt, '--starts-at') : undefined,
    endsAt: endsAt ? validateDateFlag(endsAt, '--ends-at') : undefined,
  };
}

export async function runActivityAutomationCli(): Promise<void> {
  const agentConfig = await loadConfig();
  const cliOptions = parseActivityAutomationCliOptions(process.argv.slice(2));
  const config = activityAutomationConfigFromAgentConfig(agentConfig, {
    keepBrowserOnFailure: process.env.MT_AGENT_KEEP_BROWSER_ON_FAILURE !== '0',
    confirmSubmit: cliOptions.confirmSubmit,
    pickProducts: cliOptions.pickProducts,
    draft: {
      ...createEmptyDifferentialPricingDraft(),
      startsAt: cliOptions.startsAt,
      endsAt: cliOptions.endsAt,
    },
  });
  const result = await prepareActivityFormPage(config);

  console.log([
    '\u5dee\u5f02\u5316\u5b9a\u4ef7\u9875\u9762\u4fa6\u5bdf\u5b8c\u6210\u3002',
    `\u5f53\u524d URL: ${result.url}`,
    `\u8f93\u51fa\u76ee\u5f55: ${result.outputDir}`,
    `\u622a\u56fe: ${result.screenshotPath}`,
    `\u63a7\u4ef6\u6e05\u5355: ${result.controlsPath}`,
    `\u4fa6\u5bdf\u5206\u6790: ${result.analysisPath}`,
    `\u5f55\u5236\u8349\u7a3f: ${result.recordingDraftPath}`,
    ...(result.productPickResult
      ? [
          `\u81ea\u52a8\u9009\u54c1: ${result.productPickResult.confirmed ? '\u5df2\u786e\u8ba4' : '\u672a\u786e\u8ba4'}`,
          `\u81ea\u52a8\u9009\u54c1\u6570\u91cf: ${result.productPickResult.selectedCount}`,
          `\u81ea\u52a8\u9009\u54c1\u7ffb\u9875: ${result.productPickResult.pagesVisited}`,
          `\u672c\u6b21\u4f1a\u8bdd\u52fe\u9009\u5546\u54c1: ${result.productPickResult.pickedProducts.length}`,
          ...(result.dateFillResult
            ? [
                `\u6d3b\u52a8\u65f6\u95f4\u586b\u5199: ${result.dateFillResult.filledCount}`,
                ...(config.draft.startsAt && config.draft.endsAt ? [`\u6d3b\u52a8\u65f6\u95f4\u8303\u56f4: ${config.draft.startsAt} -> ${config.draft.endsAt}`] : []),
              ]
            : []),
          ...(result.discountFillResult
            ? [
                `\u6298\u6263\u586b\u5199: ${result.discountFillResult.filledCount}`,
                `\u7a7a\u767d\u6298\u6263\u8f93\u5165: ${result.discountFillResult.emptyInputCount}`,
              ]
            : []),
          ...(result.productPickSession
            ? [
                `\u52fe\u9009\u5546\u54c1\u4ea7\u7269: ${result.productPickSessionPath}`,
                `\u5df2\u6620\u5c04\u7aef\u5185ID: ${result.productPickSession.mappedCount}`,
                `\u672a\u6620\u5c04\u7aef\u5185ID: ${result.productPickSession.unmappedCount}`,
              ]
            : []),
          ...(result.submitResult
            ? [
                `\u6d3b\u52a8\u63d0\u4ea4: ${result.submitResult.submittedAt}`,
                ...(result.submitSessionPath ? [`\u4ef7\u683c\u56de\u8c03\u4ea4\u63a5: ${result.submitSessionPath}`] : []),
              ]
            : []),
        ]
      : []),
    `\u7591\u4f3c\u53ef\u63d0\u4ea4/\u4fdd\u5b58\u63a7\u4ef6\u6570\u91cf: ${result.controls.filter((control) => control.mutating).length}`,
  ].join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runActivityAutomationCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
