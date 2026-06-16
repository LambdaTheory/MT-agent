import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config/loadConfig.js';
import { activityAutomationConfigFromAgentConfig, prepareActivityFormPage } from '../activityAutomation/index.js';

export async function runActivityAutomationCli(): Promise<void> {
  const agentConfig = await loadConfig();
  const config = activityAutomationConfigFromAgentConfig(agentConfig, { keepBrowserOnFailure: process.env.MT_AGENT_KEEP_BROWSER_ON_FAILURE !== '0' });
  const result = await prepareActivityFormPage(config);

  console.log([
    '差异化定价页面侦察完成。',
    `当前 URL: ${result.url}`,
    `输出目录: ${result.outputDir}`,
    `截图: ${result.screenshotPath}`,
    `控件清单: ${result.controlsPath}`,
    `录制草稿: ${result.recordingDraftPath}`,
    `疑似可提交/保存控件数量: ${result.controls.filter((control) => control.mutating).length}`,
  ].join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runActivityAutomationCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
