import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CustodyConflictAuditEvent, CustodyConflictAuditWriter } from './models.js';

interface CustodyConflictAuditDocument {
  runId: string;
  createdAt: string;
  events: CustodyConflictAuditEvent[];
}

function safeStamp(value: string): string {
  return value.replace(/[^\dA-Za-z_-]/g, '-');
}

export class JsonCustodyConflictAuditWriter implements CustodyConflictAuditWriter {
  readonly path: string;
  private readonly document: CustodyConflictAuditDocument;

  private constructor(outputDir: string, runId: string) {
    this.path = join(outputDir, 'custody-conflict-cleanup', `audit-${safeStamp(runId)}.json`);
    this.document = { runId, createdAt: new Date().toISOString(), events: [] };
  }

  static async create(outputDir: string, runId = new Date().toISOString()): Promise<JsonCustodyConflictAuditWriter> {
    const writer = new JsonCustodyConflictAuditWriter(outputDir, runId);
    await mkdir(join(outputDir, 'custody-conflict-cleanup'), { recursive: true });
    await writer.persist();
    return writer;
  }

  async append(event: CustodyConflictAuditEvent): Promise<void> {
    this.document.events.push(event);
    await this.persist();
  }

  private async persist(): Promise<void> {
    await writeFile(this.path, `${JSON.stringify(this.document, null, 2)}\n`, 'utf8');
  }
}
