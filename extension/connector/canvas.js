/**
 * Canvas: reads planner items and course codes with the user's existing
 * sign-in and turns them into a Polaris sync batch (see src/domain/sync.ts).
 *
 * The mapping functions are pure and covered by tests/unit/extension-canvas.test.ts.
 */

export const CANVAS_ORIGIN = 'https://canvas.illinois.edu';
const HOST = new URL(CANVAS_ORIGIN).host;

/** Planner item types that are work to hand in. Announcements and calendar events are skipped. */
export const TASK_TYPES = ['assignment', 'quiz', 'discussion_topic'];

const DAY_MS = 24 * 60 * 60 * 1000;
const PAST_DAYS = 14;
const FUTURE_DAYS = 120;
const MAX_PAGES = 20;

export class SignedOutError extends Error {
  constructor() {
    super('Not signed in to Canvas. Open canvas.illinois.edu in Chrome and sign in.');
    this.name = 'SignedOutError';
  }
}

/** The URL of the next page from a Link header, or null. */
export function nextPageUrl(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (m) return m[1];
  }
  return null;
}

/** Canvas may prefix cookie-authenticated JSON with `while(1);`. */
export const parseCanvasJson = (text) => JSON.parse(text.replace(/^while\(1\);/, ''));

/** Fetch window: two weeks back (to catch late submissions) to four months ahead. */
export function fetchWindow(now = new Date()) {
  return {
    start: new Date(now.getTime() - PAST_DAYS * DAY_MS).toISOString(),
    end: new Date(now.getTime() + FUTURE_DAYS * DAY_MS).toISOString(),
  };
}

/** Course id → name for tagging. The course code ("AE 370 A FA26") is preferred over the long name. */
export function courseNames(courses) {
  const names = new Map();
  for (const c of courses) {
    if (c && c.id != null) names.set(String(c.id), c.course_code || c.name || '');
  }
  return names;
}

/** Converts planner items to sync items. Items that aren't work to hand in are dropped. */
export function toItems(plannerItems, courses) {
  const names = courseNames(courses);
  const items = [];
  for (const p of plannerItems) {
    if (!p || !TASK_TYPES.includes(p.plannable_type) || !p.plannable) continue;
    const title = typeof p.plannable.title === 'string' ? p.plannable.title : '';
    if (!title.trim()) continue;
    const s = p.submissions || {};
    const course = (p.course_id != null && names.get(String(p.course_id))) || p.context_name || '';
    items.push({
      kind: 'canvas',
      externalId: `canvas:${HOST}:${p.plannable_type}:${p.plannable_id}`,
      title,
      course,
      url: typeof p.html_url === 'string' ? new URL(p.html_url, CANVAS_ORIGIN).href : '',
      dueAt: p.plannable.due_at || p.plannable_date || null,
      // Graded work (e.g. an exam taken in class, which is never "submitted"), excused work and
      // items the user ticked off in the Canvas planner need nothing more.
      submitted: !!(s.submitted || s.graded || s.excused || p.planner_override?.marked_complete),
    });
  }
  return items;
}

async function getAll(url, fetchImpl) {
  const results = [];
  let next = url;
  for (let page = 0; next && page < MAX_PAGES; page++) {
    const response = await fetchImpl(next, { credentials: 'include', headers: { Accept: 'application/json' } });
    if (response.status === 401 || response.redirected || new URL(response.url).pathname.startsWith('/login')) {
      throw new SignedOutError();
    }
    if (!response.ok) throw new Error(`Canvas returned an error (HTTP ${response.status}).`);
    const value = parseCanvasJson(await response.text());
    if (!Array.isArray(value)) throw new Error('Canvas returned something unexpected.');
    results.push(...value);
    next = nextPageUrl(response.headers.get('link'));
  }
  // Stopping early means the fetch wasn't complete, so missing items prove nothing.
  return { results, complete: !next };
}

/** Reads Canvas and returns a sync batch. Throws SignedOutError or Error. */
export async function fetchCanvasBatch(fetchImpl = fetch, now = new Date()) {
  const window = fetchWindow(now);
  const plannerUrl =
    `${CANVAS_ORIGIN}/api/v1/planner/items?per_page=100` +
    `&start_date=${encodeURIComponent(window.start)}&end_date=${encodeURIComponent(window.end)}`;
  const [planner, courses] = await Promise.all([
    getAll(plannerUrl, fetchImpl),
    getAll(`${CANVAS_ORIGIN}/api/v1/courses?enrollment_state=active&per_page=100`, fetchImpl),
  ]);
  return {
    kind: 'canvas',
    items: toItems(planner.results, courses.results),
    ...(planner.complete ? { window } : {}),
  };
}
