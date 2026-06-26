import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createActivityCancellationAssistant } from '../activityAutomation/cancelAssistance.js';
import { activityAutomationOutputDir } from '../activityAutomation/config.js';
import { readActivitySubmitSession } from '../activityAutomation/submitSession.js';
import { loadConfig } from '../config/loadConfig.js';

async function main(): Promise<void> {
  const agentConfig = await loadConfig();
  const submitSessionPath = 'output/latest/activity-automation/activity-submit-session.json';
  const submitSession = await readActivitySubmitSession(submitSessionPath);
  const allowAnyVisibleProduct = process.argv.includes('--any-visible');
  const productIds = [...new Set(
    (submitSession.products ?? [])
      .map((product) => product.internalProductId?.trim() ?? '')
      .filter((productId) => productId.length > 0),
  )];

  const assistant = createActivityCancellationAssistant();
  const result = await assistant.open({
    submitSessionPath,
    productIds,
    mappedCount: submitSession.mappedCount,
    startsAt: submitSession.startsAt,
    endsAt: submitSession.endsAt,
    allowAnyVisibleProduct,
  });

  const artifactDir = activityAutomationOutputDir({ outputDir: agentConfig.outputDir });
  await writeFile(join(artifactDir, 'activity-cancel-live-result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));
}

void main();
