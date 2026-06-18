import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const PUBLIC_TRAFFIC_ARTIFACT_VERSION = 1;

export const PUBLIC_TRAFFIC_ARTIFACT_STAGES = ['goods-export', 'exposure', 'dashboard', 'order-analysis'] as const;

export type PublicTrafficArtifactStage = typeof PUBLIC_TRAFFIC_ARTIFACT_STAGES[number];

export type PublicTrafficArtifactFreshness = 'fresh' | 'stale' | 'not_updated' | 'empty_confirmed';

export interface PublicTrafficArtifactManifest {
  artifactVersion: typeof PUBLIC_TRAFFIC_ARTIFACT_VERSION;
  runDate: string;
  capturedAt: string;
  source: 'alipay';
  stage: PublicTrafficArtifactStage;
  sourceUrl: string;
  merchantVerified: boolean;
  dataDate?: string;
  freshness?: PublicTrafficArtifactFreshness;
  notes?: string[];
  files: Record<string, string>;
}

export interface BuildPublicTrafficArtifactManifestInput {
  artifactVersion?: typeof PUBLIC_TRAFFIC_ARTIFACT_VERSION;
  runDate: string;
  capturedAt?: string;
  source?: 'alipay';
  stage: PublicTrafficArtifactStage;
  sourceUrl: string;
  merchantVerified?: boolean;
  dataDate?: string;
  freshness?: PublicTrafficArtifactFreshness;
  notes?: string[];
  files: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isArtifactStage(value: unknown): value is PublicTrafficArtifactStage {
  return typeof value === 'string' && PUBLIC_TRAFFIC_ARTIFACT_STAGES.includes(value as PublicTrafficArtifactStage);
}

function isArtifactFreshness(value: unknown): value is PublicTrafficArtifactFreshness {
  return value === 'fresh' || value === 'stale' || value === 'not_updated' || value === 'empty_confirmed';
}

export function buildPublicTrafficArtifactManifestPath(outputDir: string, date: string, stage: PublicTrafficArtifactStage): string {
  return `${outputDir}/${date}/artifacts/${stage}-manifest.json`;
}

export function buildPublicTrafficArtifactManifest(input: BuildPublicTrafficArtifactManifestInput): PublicTrafficArtifactManifest {
  return {
    artifactVersion: input.artifactVersion ?? PUBLIC_TRAFFIC_ARTIFACT_VERSION,
    runDate: input.runDate,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    source: input.source ?? 'alipay',
    stage: input.stage,
    sourceUrl: input.sourceUrl,
    merchantVerified: input.merchantVerified ?? true,
    ...(input.dataDate === undefined ? {} : { dataDate: input.dataDate }),
    ...(input.freshness === undefined ? {} : { freshness: input.freshness }),
    ...(input.notes === undefined || input.notes.length === 0 ? {} : { notes: input.notes }),
    files: input.files,
  };
}

export function isPublicTrafficArtifactManifest(value: unknown): value is PublicTrafficArtifactManifest {
  if (!isRecord(value)) return false;
  if (value.artifactVersion !== PUBLIC_TRAFFIC_ARTIFACT_VERSION) return false;
  if (typeof value.runDate !== 'string') return false;
  if (typeof value.capturedAt !== 'string') return false;
  if (value.source !== 'alipay') return false;
  if (!isArtifactStage(value.stage)) return false;
  if (typeof value.sourceUrl !== 'string') return false;
  if (typeof value.merchantVerified !== 'boolean') return false;
  if (value.dataDate !== undefined && typeof value.dataDate !== 'string') return false;
  if (value.freshness !== undefined && !isArtifactFreshness(value.freshness)) return false;
  if (value.notes !== undefined && (!Array.isArray(value.notes) || !value.notes.every((note) => typeof note === 'string'))) return false;
  if (!isRecord(value.files) || !Object.values(value.files).every((file) => typeof file === 'string')) return false;
  return true;
}

export function parsePublicTrafficArtifactManifest(text: string): PublicTrafficArtifactManifest {
  const parsed: unknown = JSON.parse(text);
  if (!isPublicTrafficArtifactManifest(parsed)) {
    throw new Error('Invalid public traffic artifact manifest');
  }
  return parsed;
}

export async function loadPublicTrafficArtifactManifest(path: string): Promise<PublicTrafficArtifactManifest | null> {
  try {
    return parsePublicTrafficArtifactManifest(await readFile(path, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function savePublicTrafficArtifactManifest(path: string, manifest: PublicTrafficArtifactManifest): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}
