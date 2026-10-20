import { describe, expect, it } from 'vitest';
import { toItems as canvasItems } from '../../extension/connector/canvas.js';
import {
  LayoutError,
  SignedOutError,
  currentCourses,
  fetchGradescopeBatch,
  parseCoursePage,
  parseDashboard,
  parseGradescopeDate,
  textOf,
} from '../../extension/connector/gradescope.js';
import { applySync, parseSyncBatch } from '../../src/domain/sync';
import { emptyData } from '../../src/domain/types';
import { testCtx } from './helpers';

/** Shaped like the student dashboard: newest term first, course cards under each term heading. */
const DASHBOARD = `
<div class="courseList">
  <h2 class="pageHeading">Your Courses</h2>
  <div class="courseList--term pageSubheading">Fall 2026</div>
  <div class="courseList--coursesForTerm">
    <a class="courseBox" href="/courses/1366944">
      <h3 class="courseBox--shortname">AE 370</h3>
      <div class="courseBox--name">Aerospace Numerical Methods</div>
    </a>
    <a href="/courses/1360272" class="courseBox">
      <h3 class="courseBox--shortname">ae_312_120268_262662</h3>
    </a>
    <a class="courseBox courseBox--add" href="#">Add a course</a>
  </div>
  <div class="courseList--term pageSubheading">Spring 2025</div>
  <div class="courseList--coursesForTerm">
    <a class="courseBox" href="/courses/981247"><h3 class="courseBox--shortname">AE 298 RES SPRING 2025</h3></a>
  </div>
</div>`;

/** Shaped like a course's student assignment table. */
const COURSE = `
<table id="assignments-student-table" class="table">
  <thead><tr role="row"><th>Name</th><th>Status</th><th>Released</th><th>Due</th></tr></thead>
  <tbody>
    <tr role="row" class="odd">
      <th class="table--primaryLink" role="rowheader" scope="row">
        <a aria-label="View Homework 4" href="/courses/1366944/assignments/7001/submissions/91">Homework 4</a>
      </th>
      <td class="submissionStatus"><div class="submissionStatus--score">9.5 / 10.0</div></td>
      <td class="hidden-column"><div class="submissionTimeChart">
        <time class="submissionTimeChart--releaseDate" datetime="2026-10-01 10:00:00 -0500">Oct 01</time>
        <time class="submissionTimeChart--dueDate" datetime="2026-10-16 14:00:00 -0500">Due at 2:00PM</time>
      </div></td>
    </tr>
    <tr role="row" class="even">
      <th class="table--primaryLink" role="rowheader" scope="row">
        <a href="/courses/1366944/assignments/7002/submissions/92">Homework 5 &amp; Lab</a>
      </th>
      <td class="submissionStatus"><div class="submissionStatus--text">Submitted</div></td>
      <td><time datetime="2026-10-23 14:00:00 -0500" class="submissionTimeChart--dueDate">Due</time>
          <time class="submissionTimeChart--dueDate" datetime="2026-10-25 14:00:00 -0500">Late Due Date</time></td>
    </tr>
    <tr role="row" class="odd">
      <th class="table--primaryLink" role="rowheader" scope="row">
        <button class="js-submitAssignment" data-assignment-id="7003" data-assignment-title="Homework 6" type="button">Homework 6</button>
      </th>
      <td class="submissionStatus"><div class="submissionStatus--text">No Submission</div></td>
      <td><time class="submissionTimeChart--dueDate" datetime="2026-10-30 14:00:00 -0500">Due</time></td>
    </tr>
    <tr role="row" class="even">
      <th class="table--primaryLink" role="rowheader" scope="row">Midterm (in class)</th>
      <td class="submissionStatus"><div class="submissionStatus--text">No Submission</div></td>
      <td><time class="submissionTimeChart--dueDate" datetime="2026-11-05 11:00:00 -0600">Due</time></td>
    </tr>
    <tr role="row" class="odd">
      <th class="table--primaryLink" role="rowheader" scope="row"><a href="/courses/1366944/assignments/6001/submissions/80">Homework 1</a></th>
      <td class="submissionStatus"><div class="submissionStatus--score">10.0 / 10.0</div></td>
      <td><time class="submissionTimeChart--dueDate" datetime="2026-09-04 14:00:00 -0500">Due</time></td>
    </tr>
  </tbody>
</table>`;

/** A second course with one open assignment. */
const OTHER_COURSE = `
<table id="assignments-student-table"><tbody>
  <tr role="row"><th class="table--primaryLink" role="rowheader" scope="row">
    <button class="js-submitAssignment" data-assignment-id="8100" data-assignment-title="Lab 2" type="button">Lab 2</button></th>
    <td><div class="submissionStatus--text">No Submission</div></td>
    <td><time class="submissionTimeChart--dueDate" datetime="2026-10-28 23:59:00 -0500">Due</time></td></tr>
</tbody></table>`;

const NOW = new Date('2026-10-19T12:00:00Z');

describe('Gradescope dashboard', () => {
  it('lists courses with their term, skipping cards that are not courses', () => {
    expect(parseDashboard(DASHBOARD)).toEqual([
      { id: '1366944', name: 'AE 370', term: 'Fall 2026' },
      { id: '1360272', name: 'ae_312_120268_262662', term: 'Fall 2026' },
      { id: '981247', name: 'AE 298 RES SPRING 2025', term: 'Spring 2025' },
    ]);
  });

  it('keeps only the newest term, or every course when terms are not shown', () => {
    expect(currentCourses(parseDashboard(DASHBOARD)).map((c) => c.id)).toEqual(['1366944', '1360272']);
    const noTerms = DASHBOARD.replace(/courseList--term/g, 'x');
    expect(currentCourses(parseDashboard(noTerms))).toHaveLength(3);
  });
});

describe('Gradescope course page', () => {
  const rows = parseCoursePage(COURSE, '1366944');

  it('reads every assignment row and skips the header', () => {
    expect(rows.map((r) => r.title)).toEqual(['Homework 4', 'Homework 5 & Lab', 'Homework 6', 'Midterm (in class)', 'Homework 1']);
  });

  it('never turns a column header into an assignment, whatever it says', () => {
    const renamed = COURSE.replace('<th>Name</th>', '<th><button>Assignment</button> <span class="sr-only">sorted ascending</span></th>');
    expect(parseCoursePage(renamed, '1366944').map((r) => r.title)).not.toContain('Assignment sorted ascending');
    expect(parseCoursePage(renamed, '1366944')).toHaveLength(5);
  });

  it('treats a score or “Submitted” as done and “No Submission” as open', () => {
    expect(rows.map((r) => r.submitted)).toEqual([true, true, false, false, true]);
  });

  it('uses the regular due date, not the late one, with its time zone', () => {
    expect(rows[1]!.dueAt).toBe('2026-10-23T19:00:00.000Z');
    expect(rows[3]!.dueAt).toBe('2026-11-05T17:00:00.000Z');
  });

  it('builds stable keys and links, even for rows without an assignment ID', () => {
    expect(rows[0]).toMatchObject({
      externalId: 'gradescope:assignment:7001',
      url: 'https://www.gradescope.com/courses/1366944/assignments/7001/submissions/91',
    });
    expect(rows[2]).toMatchObject({ externalId: 'gradescope:assignment:7003', url: 'https://www.gradescope.com/courses/1366944' });
    expect(rows[3]!.externalId).toBe('gradescope:course:1366944:midterm-in-class');
  });

  it('takes an assignment ID from another cell when the name cell has none', () => {
    const row = (cells: string) => `
<table id="assignments-student-table"><tbody>
  <tr role="row"><th class="table--primaryLink" role="rowheader" scope="row">Quiz 2</th>${cells}</tr>
</tbody></table>`;
    const fromData = row('<td><div class="submissionStatus" data-assignment-id="7010">No Submission</div></td>');
    expect(parseCoursePage(fromData, '1366944')[0]!.externalId).toBe('gradescope:assignment:7010');
    const fromLink = row('<td><a href="/courses/1366944/assignments/7011/submissions/new">Submit</a></td>');
    expect(parseCoursePage(fromLink, '1366944')[0]!.externalId).toBe('gradescope:assignment:7011');
    // A link to another course's assignment is not this row's ID.
    const otherCourse = row('<td><a href="/courses/42/assignments/9/submissions/1">Related</a></td>');
    expect(parseCoursePage(otherCourse, '1366944')[0]!.externalId).toBe('gradescope:course:1366944:quiz-2');
  });

  it('parses Gradescope dates and text', () => {
    expect(parseGradescopeDate('2026-09-04 14:00:00 -0500')).toBe('2026-09-04T19:00:00.000Z');
    expect(parseGradescopeDate('not a date')).toBeNull();
    expect(textOf('<b>Lab&nbsp;3</b> &#8211; &#x2014; ok')).toBe('Lab 3 – — ok');
  });
});

function fakeFetch(pages: Record<string, string>, finalUrl?: (url: string) => string) {
  return (async (input: string) => {
    const path = new URL(input).pathname;
    const body = pages[path];
    return {
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      url: finalUrl ? finalUrl(input) : input,
      text: async () => body ?? '',
    };
  }) as unknown as typeof fetch;
}

describe('fetching from Gradescope', () => {
  it('reads current-term courses and keeps assignments inside the window', async () => {
    const batch = await fetchGradescopeBatch(
      fakeFetch({ '/account': DASHBOARD, '/courses/1366944': COURSE, '/courses/1360272': OTHER_COURSE }),
      NOW,
    );
    // Homework 1 (Sep 4) is before the two-week window; Spring 2025 isn't fetched at all.
    expect(batch.items.map((i) => i.title)).toEqual(['Homework 4', 'Homework 5 & Lab', 'Homework 6', 'Midterm (in class)', 'Lab 2']);
    expect(batch.items[0]).toMatchObject({ kind: 'gradescope', course: 'AE 370' });
    expect(batch.window).toBeDefined();
    expect(batch.fetchedAt).toBe(NOW.toISOString());
  });

  it('claims a complete fetch only when every course page was read', async () => {
    const batch = await fetchGradescopeBatch(
      fakeFetch({ '/account': DASHBOARD, '/courses/1366944': COURSE, '/courses/1360272': '<div>redesigned page</div>' }),
      NOW,
    );
    expect(batch.items).toHaveLength(4);
    expect(batch.window).toBeUndefined();
  });

  it('reports a signed-out user clearly', async () => {
    const login = fakeFetch({ '/account': '<input name="session[password]">' }, () => 'https://www.gradescope.com/login');
    await expect(fetchGradescopeBatch(login, NOW)).rejects.toBeInstanceOf(SignedOutError);
  });

  it('says so when the pages no longer look as expected', async () => {
    await expect(fetchGradescopeBatch(fakeFetch({ '/account': '<div>new design</div>' }), NOW)).rejects.toBeInstanceOf(LayoutError);
    const noRows = fakeFetch({ '/account': DASHBOARD, '/courses/1366944': '<div></div>', '/courses/1360272': '<div></div>' });
    await expect(fetchGradescopeBatch(noRows, NOW)).rejects.toBeInstanceOf(LayoutError);
  });
});

describe('Gradescope and Canvas together', () => {
  it('links a Gradescope assignment to the Canvas task for it, and a score completes it', async () => {
    const canvas = canvasItems(
      [
        {
          plannable_type: 'assignment',
          plannable_id: 501,
          course_id: 9,
          html_url: '/courses/9/assignments/501',
          plannable: { title: 'Homework 6', due_at: '2026-10-30T19:00:00Z' },
          submissions: { submitted: false },
        },
      ],
      [{ id: 9, course_code: 'AE 370 A FA26' }],
    );
    const ctx = testCtx();
    const first = applySync(emptyData(), parseSyncBatch({ kind: 'canvas', items: canvas })!.batch, ctx).data;

    // Homework 6 gets a score.
    const graded = COURSE.replace(
      /<div class="submissionStatus--text">No Submission<\/div>(<\/td>\s*<td><time class="submissionTimeChart--dueDate" datetime="2026-10-30)/,
      '<div class="submissionStatus--score">8 / 10</div>$1',
    );
    expect(graded).not.toBe(COURSE);
    const batch = await fetchGradescopeBatch(
      fakeFetch({ '/account': DASHBOARD, '/courses/1366944': graded, '/courses/1360272': COURSE.replace(/7\d{3}/g, '8000') }),
      NOW,
    );
    const { data } = applySync(first, parseSyncBatch(batch)!.batch, ctx);
    const hw6 = data.tasks.filter((t) => t.title === 'Homework 6');
    expect(hw6).toHaveLength(1);
    expect(hw6[0]!.source?.aliases).toEqual(['gradescope:assignment:7003']);
    expect(hw6[0]!.completedAt).not.toBeNull();
  });
});
