/**
 * Gradescope: no public API, so this reads the pages a signed-in student sees,
 * the dashboard (course list) and each course's assignment table, and turns
 * them into a Polaris sync batch (see src/domain/sync.ts).
 *
 * Parsing uses small string helpers instead of DOMParser, which MV3 service
 * workers don't have. Covered by tests/unit/extension-gradescope.test.ts.
 */

export const GRADESCOPE_ORIGIN = 'https://www.gradescope.com';

const DAY_MS = 24 * 60 * 60 * 1000;
const PAST_DAYS = 14;
const FUTURE_DAYS = 120;
const MAX_COURSES = 15;

export class SignedOutError extends Error {
  constructor() {
    super('Not signed in to Gradescope. Open gradescope.com in Chrome and sign in.');
    this.name = 'SignedOutError';
  }
}

/** The page didn't look like what this parser expects; Gradescope may have changed its layout. */
export class LayoutError extends Error {
  constructor(what) {
    super(`Gradescope's ${what} looks different than expected, so no assignments were read.`);
    this.name = 'LayoutError';
  }
}

// ---- HTML helpers -------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Visible text of an HTML fragment, on one line. */
export const textOf = (html) => decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

function attr(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? decodeEntities(m[1] ?? m[2] ?? '') : null;
}

/** Opening tags whose class list contains `cls`, with their positions. */
function tagsWithClass(html, cls) {
  const found = [];
  for (const m of html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*>/gi)) {
    const classes = (attr(m[0], 'class') ?? '').split(/\s+/);
    if (classes.includes(cls)) found.push({ tag: m[0], name: m[1].toLowerCase(), start: m.index, end: m.index + m[0].length });
  }
  return found;
}

/** Content of an element up to its closing tag (fine for elements without the same tag nested inside). */
function innerHtml(html, el) {
  const close = html.toLowerCase().indexOf(`</${el.name}`, el.end);
  return html.slice(el.end, close < 0 ? undefined : close);
}

/** Gradescope datetimes look like "2026-09-04 14:00:00 -0500". */
export function parseGradescopeDate(value) {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s*([+-]\d{2}):?(\d{2})$/.exec(value.trim());
  const iso = m ? `${m[1]}T${m[2]}${m[3]}:${m[4]}` : value;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

// ---- pages ----------------------------------------------------------------------

/**
 * Courses on the dashboard, each with the term heading it is listed under.
 * Gradescope lists the newest term first.
 */
export function parseDashboard(html) {
  const terms = tagsWithClass(html, 'courseList--term').map((t) => ({ start: t.start, name: textOf(innerHtml(html, t)) }));
  const courses = [];
  for (const box of tagsWithClass(html, 'courseBox')) {
    const href = attr(box.tag, 'href') ?? '';
    const id = /\/courses\/(\d+)/.exec(href)?.[1];
    if (!id) continue;
    const rest = html.slice(box.end, html.indexOf('</a', box.end));
    const short = tagsWithClass(rest, 'courseBox--shortname')[0];
    const name = short ? textOf(innerHtml(rest, short)) : textOf(rest);
    const term = terms.filter((t) => t.start < box.start).at(-1)?.name ?? '';
    if (!courses.some((c) => c.id === id)) courses.push({ id, name, term });
  }
  return courses;
}

/** Only the newest term's courses, so past terms aren't fetched. All courses when no terms are shown. */
export function currentCourses(courses) {
  const term = courses.find((c) => c.term)?.term;
  return term ? courses.filter((c) => c.term === term) : courses;
}

const titleKey = (title) => title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');

/** Assignment rows from a course page's table. */
export function parseCoursePage(html, courseId) {
  const tableStart = html.search(/id=["']assignments-student-table["']/);
  const table = tableStart < 0 ? html : html.slice(tableStart);
  const rows = [];
  for (const chunk of table.split(/<tr\b/i).slice(1)) {
    const close = chunk.search(/<\/tr>/i);
    const row = close < 0 ? chunk : chunk.slice(0, close);
    // The first header cell holds the assignment: a link (submitted), a button (can submit) or plain text.
    const cellMatch = /<th\b[^>]*>([\s\S]*?)<\/th>/i.exec(row);
    if (!cellMatch) continue;
    const cell = cellMatch[1];
    const button = /<button\b[^>]*>/i.exec(cell)?.[0];
    const link = /<a\b[^>]*>/i.exec(cell)?.[0];
    const title = (button && attr(button, 'data-assignment-title')) || textOf(cell);
    if (!title || /^name$/i.test(title)) continue;

    const href = link ? attr(link, 'href') : null;
    const assignmentId =
      (button && attr(button, 'data-assignment-id')) || (href && /\/assignments\/(\d+)/.exec(href)?.[1]) || null;
    const due = tagsWithClass(row, 'submissionTimeChart--dueDate')[0];
    const score = tagsWithClass(row, 'submissionStatus--score')[0];
    const statusEl = tagsWithClass(row, 'submissionStatus--text')[0];
    const status = statusEl ? textOf(innerHtml(row, statusEl)) : '';

    rows.push({
      externalId: assignmentId ? `gradescope:assignment:${assignmentId}` : `gradescope:course:${courseId}:${titleKey(title)}`,
      title,
      url: href ? new URL(href, GRADESCOPE_ORIGIN).href : `${GRADESCOPE_ORIGIN}/courses/${courseId}`,
      dueAt: due ? parseGradescopeDate(attr(due.tag, 'datetime')) : null,
      // A score means it was graded; otherwise trust the status text ("Submitted" vs "No Submission").
      submitted: !!score || (/\bsubmitted\b/i.test(status) && !/no submission/i.test(status)),
    });
  }
  return rows;
}

export function fetchWindow(now = new Date()) {
  return {
    start: new Date(now.getTime() - PAST_DAYS * DAY_MS).toISOString(),
    end: new Date(now.getTime() + FUTURE_DAYS * DAY_MS).toISOString(),
  };
}

/** Sync items for one course: assignments due inside the window (or with no deadline). */
export function toItems(rows, courseName, window) {
  const start = Date.parse(window.start);
  const end = Date.parse(window.end);
  return rows
    .filter((r) => r.dueAt === null || (Date.parse(r.dueAt) >= start && Date.parse(r.dueAt) <= end))
    .map((r) => ({ kind: 'gradescope', course: courseName, ...r }));
}

// ---- fetching -------------------------------------------------------------------

async function getPage(path, fetchImpl) {
  const response = await fetchImpl(`${GRADESCOPE_ORIGIN}${path}`, { credentials: 'include', headers: { Accept: 'text/html' } });
  const html = await response.text();
  const finalPath = new URL(response.url).pathname;
  if (response.status === 401 || finalPath === '/login' || finalPath === '/' || /name=["']session\[password\]["']/.test(html)) {
    throw new SignedOutError();
  }
  if (!response.ok) throw new Error(`Gradescope returned an error (HTTP ${response.status}).`);
  return html;
}

/**
 * Reads Gradescope and returns a sync batch, stamped with `fetchedAt` (when the
 * fetch started). Throws SignedOutError, LayoutError or Error.
 */
export async function fetchGradescopeBatch(fetchImpl = fetch, now = new Date()) {
  const window = fetchWindow(now);
  const courses = currentCourses(parseDashboard(await getPage('/account', fetchImpl))).slice(0, MAX_COURSES);
  if (!courses.length) throw new LayoutError('course list');

  const items = [];
  let rowCount = 0;
  // One course at a time, to be gentle on Gradescope.
  for (const course of courses) {
    const rows = parseCoursePage(await getPage(`/courses/${course.id}`, fetchImpl), course.id);
    rowCount += rows.length;
    items.push(...toItems(rows, course.name, window));
  }
  if (!rowCount) throw new LayoutError('assignment table');
  return { kind: 'gradescope', items, window, fetchedAt: now.toISOString() };
}
