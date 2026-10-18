/** Export and import (restore) of the portable JSON backup format. */
import type { AppData } from '../domain/types';
import { SchemaError, parseEnvelope, serialize } from './schema';

export function exportFilename(today: string): string {
  return `polaris-backup-${today}.json`;
}

/** Pretty-printed envelope; identical structure to what is stored. */
export function exportJson(data: AppData, now: string): string {
  return JSON.stringify(JSON.parse(serialize(data, now)), null, 2) + '\n';
}

export interface ImportPreview {
  data: AppData;
  taskCount: number;
  tagCount: number;
  openCount: number;
  issues: string[];
}

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

/** Validates a backup file's text. Throws SchemaError with a readable message. */
export function parseBackup(text: string): ImportPreview {
  if (text.length > MAX_IMPORT_BYTES) throw new SchemaError('That file is too large to be a Polaris backup.');
  if (!text.trim()) throw new SchemaError('That file is empty.');
  const { data, issues } = parseEnvelope(text);
  return {
    data,
    taskCount: data.tasks.length,
    tagCount: data.tags.length,
    openCount: data.tasks.filter((t) => !t.completedAt).length,
    issues,
  };
}
