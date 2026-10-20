// Types for gradescope.js, so the Polaris unit tests can check its parsing.
import type { ExternalItem, SyncBatch } from '../../src/domain/sync';

export interface GradescopeCourse {
  id: string;
  name: string;
  term: string;
}

export interface GradescopeRow {
  externalId: string;
  title: string;
  url: string;
  dueAt: string | null;
  submitted: boolean;
}

export const GRADESCOPE_ORIGIN: string;
export class SignedOutError extends Error {}
export class LayoutError extends Error {}
export function decodeEntities(s: string): string;
export function textOf(html: string): string;
export function parseGradescopeDate(value: string | null): string | null;
export function parseDashboard(html: string): GradescopeCourse[];
export function currentCourses(courses: GradescopeCourse[]): GradescopeCourse[];
export function parseCoursePage(html: string, courseId: string): GradescopeRow[];
export function fetchWindow(now?: Date): { start: string; end: string };
export function toItems(rows: GradescopeRow[], courseName: string, window: { start: string; end: string }): ExternalItem[];
export function fetchGradescopeBatch(fetchImpl?: typeof fetch, now?: Date): Promise<SyncBatch>;
