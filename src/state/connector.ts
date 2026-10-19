/**
 * Message protocol between Polaris and the Polaris Connector extension. The
 * extension's content script and this page talk with window.postMessage on the
 * page's own origin; only messages from this window and origin are accepted.
 *
 * Extension → page:
 *   { from: 'polaris-connector', type: 'hello', version }
 *   { from: 'polaris-connector', type: 'batch', batch }          (see SyncBatch)
 *   { from: 'polaris-connector', type: 'status', kind, ok, message?, at }
 * Page → extension:
 *   { from: 'polaris-app', type: 'ready' }      (page loaded; send cached batches)
 *   { from: 'polaris-app', type: 'sync-now' }
 */
import type { SyncSummary } from '../domain/sync';
import { SOURCE_KINDS, type SourceKind } from '../domain/types';
import { cleanLine } from '../domain/validation';

export const FROM_CONNECTOR = 'polaris-connector';
export const FROM_APP = 'polaris-app';

export interface SourceStatus {
  at: string;
  ok: boolean;
  message: string | null;
}

export type ConnectorMessage =
  | { type: 'hello'; version: string }
  | { type: 'batch'; batch: unknown }
  | { type: 'status'; kind: SourceKind; status: SourceStatus };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function readConnectorMessage(e: MessageEvent): ConnectorMessage | null {
  if (e.source !== window || e.origin !== location.origin) return null;
  const msg: unknown = e.data;
  if (!isObject(msg) || msg.from !== FROM_CONNECTOR) return null;
  if (msg.type === 'hello') return { type: 'hello', version: cleanLine(msg.version).slice(0, 20) || 'unknown' };
  if (msg.type === 'batch') return { type: 'batch', batch: msg.batch };
  if (msg.type === 'status' && SOURCE_KINDS.includes(msg.kind as SourceKind) && typeof msg.ok === 'boolean') {
    const at = typeof msg.at === 'string' && !Number.isNaN(Date.parse(msg.at)) ? msg.at : new Date().toISOString();
    const message = cleanLine(msg.message).slice(0, 300) || null;
    return { type: 'status', kind: msg.kind as SourceKind, status: { at, ok: msg.ok, message } };
  }
  return null;
}

export function sendToConnector(type: 'ready' | 'sync-now') {
  window.postMessage({ from: FROM_APP, type }, location.origin);
}

export const SOURCE_NAMES: Record<SourceKind, string> = { canvas: 'Canvas', gradescope: 'Gradescope' };

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "added 2 assignments, completed 1", or null when nothing changed. */
export function describeSummary(summary: SyncSummary): string | null {
  const parts = [
    summary.added && `added ${count(summary.added, 'assignment')}`,
    summary.completed && `completed ${summary.completed}`,
    summary.removed && `${summary.removed} no longer listed`,
    !summary.added && !summary.completed && !summary.removed && summary.updated && `updated ${count(summary.updated, 'task')}`,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** "Canvas: added 2 assignments, completed 1." or null when nothing changed. */
export function describeSync(kind: SourceKind, summary: SyncSummary): string | null {
  const text = describeSummary(summary);
  return text ? `${SOURCE_NAMES[kind]}: ${text}.` : null;
}
