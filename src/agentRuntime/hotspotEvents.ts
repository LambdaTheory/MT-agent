import { readFile } from 'node:fs/promises';

export interface HotspotEvent {
  eventId: string;
  source: 'manual' | 'feishu' | 'api';
  title: string;
  startsAt: string;
  endsAt?: string;
  city?: string;
  venue?: string;
  affectedCategories: string[];
  heatScore?: number;
  confidence: 'low' | 'medium' | 'high';
  rawRef?: string;
}

export interface HotspotEventProvider {
  listEvents(input: { date: string; lookaheadDays: number }): Promise<HotspotEvent[]>;
}

function isHotspotEvent(value: unknown): value is HotspotEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return typeof event.eventId === 'string'
    && (event.source === 'manual' || event.source === 'feishu' || event.source === 'api')
    && typeof event.title === 'string'
    && typeof event.startsAt === 'string'
    && Array.isArray(event.affectedCategories)
    && event.affectedCategories.every((category) => typeof category === 'string')
    && (event.confidence === 'low' || event.confidence === 'medium' || event.confidence === 'high');
}

export class FileHotspotEventProvider implements HotspotEventProvider {
  constructor(private readonly options: { path: string }) {}

  async listEvents(input: { date: string; lookaheadDays: number }): Promise<HotspotEvent[]> {
    const parsed = JSON.parse(await readFile(this.options.path, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) return [];

    const start = new Date(`${input.date}T00:00:00.000Z`).getTime();
    const end = start + input.lookaheadDays * 24 * 60 * 60 * 1000;
    return parsed.filter(isHotspotEvent).filter((event) => {
      const startsAt = new Date(event.startsAt).getTime();
      return Number.isFinite(startsAt) && startsAt >= start && startsAt <= end;
    });
  }
}
