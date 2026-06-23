import type { Page } from 'playwright';

export interface ActivityFormWorkaround {
  name: string;
  detect(page: Page): Promise<boolean>;
  apply(page: Page): Promise<void>;
}

export const activityFormWorkarounds: ActivityFormWorkaround[] = [];

export async function detectActivityFormWorkarounds(page: Page, workarounds: ActivityFormWorkaround[] = activityFormWorkarounds): Promise<string[]> {
  const detected: string[] = [];
  for (const workaround of workarounds) {
    if (await workaround.detect(page)) detected.push(workaround.name);
  }
  return detected;
}
