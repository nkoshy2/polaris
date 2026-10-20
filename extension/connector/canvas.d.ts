// Types for canvas.js, so the Polaris unit tests can check its mapping.
import type { ExternalItem, SyncBatch } from '../../src/domain/sync';

export const CANVAS_ORIGIN: string;
export const TASK_TYPES: string[];
export class SignedOutError extends Error {}
export function nextPageUrl(linkHeader: string | null): string | null;
export function parseCanvasJson(text: string): unknown;
export function fetchWindow(now?: Date): { start: string; end: string };
export function courseNames(courses: unknown[]): Map<string, string>;
export function toItems(plannerItems: unknown[], courses: unknown[]): ExternalItem[];
export function fetchCanvasBatch(fetchImpl?: typeof fetch, now?: Date): Promise<SyncBatch>;
