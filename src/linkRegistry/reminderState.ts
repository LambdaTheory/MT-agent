import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type LinkRegistryReminderKind = 'maintenance' | 'governance';
export type LinkRegistryReminderStatus = 'prompted' | 'reviewing' | 'snoozed' | 'ignored' | 'completed';

export interface LinkRegistryReminderStateRecord {
  signature: string;
  status: LinkRegistryReminderStatus;
  sessionDate: string;
  updatedAt: string;
}

interface LinkRegistryReminderStateFile {
  version: 1;
  maintenance?: LinkRegistryReminderStateRecord;
  governance?: LinkRegistryReminderStateRecord;
}

const REMINDER_STATE_FILE = 'link-registry-reminder-state.json';

function reminderStatePath(outputDir: string): string {
  return join(outputDir, 'latest', REMINDER_STATE_FILE);
}

async function readReminderStateFile(path: string): Promise<LinkRegistryReminderStateFile> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as LinkRegistryReminderStateFile;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return { version: 1 };
    }
    throw error;
  }
}

async function saveReminderStateFile(path: string, file: LinkRegistryReminderStateFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
}

export async function loadLinkRegistryReminderState(
  outputDir: string,
  kind: LinkRegistryReminderKind,
): Promise<LinkRegistryReminderStateRecord | null> {
  const file = await readReminderStateFile(reminderStatePath(outputDir));
  return file[kind] ?? null;
}

export async function saveLinkRegistryReminderState(
  outputDir: string,
  kind: LinkRegistryReminderKind,
  record: LinkRegistryReminderStateRecord,
): Promise<void> {
  const path = reminderStatePath(outputDir);
  const file = await readReminderStateFile(path);
  await saveReminderStateFile(path, { ...file, version: 1, [kind]: record });
}
