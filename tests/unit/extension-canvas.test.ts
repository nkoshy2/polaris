import { describe, expect, it } from 'vitest';
import { SignedOutError, fetchCanvasBatch, nextPageUrl, toItems } from '../../extension/connector/canvas.js';
import { applySync, parseSyncBatch } from '../../src/domain/sync';
import { emptyData } from '../../src/domain/types';
import { testCtx } from './helpers';

const course = { id: 9, name: 'Fall 2026-AE 370-Aerospace Numerical Methods-Section A', course_code: 'AE 370 A FA26' };

/** Shaped like the real planner items the feasibility check returned. */
const planner = [
  {
    plannable_type: 'assignment',
    plannable_id: 101,
    course_id: 9,
    context_name: course.name,
    html_url: '/courses/9/assignments/101',
    plannable: { title: 'Homework 5', due_at: '2026-10-25T04:59:00Z' },
    plannable_date: '2026-10-25T04:59:00Z',
    submissions: { submitted: false, excused: false, graded: false },
  },
  {
    plannable_type: 'quiz',
    plannable_id: 7,
    course_id: 9,
    html_url: '/courses/9/quizzes/7',
    plannable: { title: 'Quiz 3', due_at: null },
    plannable_date: '2026-10-22T17:00:00Z',
    submissions: { submitted: true },
  },
  {
    plannable_type: 'discussion_topic',
    plannable_id: 55,
    course_id: 404,
    context_name: 'AE Advising',
    html_url: '/courses/404/discussion_topics/55',
    plannable: { title: 'Intro post' },
    plannable_date: '2026-10-20T12:00:00Z',
    submissions: { excused: true },
  },
  {
    plannable_type: 'assignment',
    plannable_id: 102,
    course_id: 9,
    html_url: '/courses/9/assignments/102',
    plannable: { title: 'Reading', due_at: '2026-10-21T04:59:00Z' },
    submissions: false,
    planner_override: { marked_complete: true },
  },
  {
    // An exam taken in class: never submitted in Canvas, but graded.
    plannable_type: 'assignment',
    plannable_id: 103,
    course_id: 9,
    html_url: '/courses/9/assignments/103',
    plannable: { title: 'Averaging Exam 1 - Problem 1', due_at: '2026-10-08T04:59:00Z' },
    submissions: { submitted: false, excused: false, graded: true },
  },
  { plannable_type: 'announcement', plannable_id: 1, plannable: { title: 'Exam #1 room allocations' } },
  { plannable_type: 'calendar_event', plannable_id: 2, plannable: { title: 'Office hours' } },
  { plannable_type: 'assignment', plannable_id: 3, plannable: { title: '   ' } },
];

describe('Canvas planner items', () => {
  it('keeps work to hand in, skipping announcements, events and untitled items', () => {
    expect(toItems(planner, [course]).map((i) => i.title)).toEqual([
      'Homework 5',
      'Quiz 3',
      'Intro post',
      'Reading',
      'Averaging Exam 1 - Problem 1',
    ]);
  });

  it('maps fields: stable key, course code, absolute link, deadline and submission', () => {
    const [hw, quiz, intro, reading, exam] = toItems(planner, [course]);
    expect(hw).toEqual({
      kind: 'canvas',
      externalId: 'canvas:canvas.illinois.edu:assignment:101',
      title: 'Homework 5',
      course: 'AE 370 A FA26',
      url: 'https://canvas.illinois.edu/courses/9/assignments/101',
      dueAt: '2026-10-25T04:59:00Z',
      submitted: false,
    });
    expect(quiz).toMatchObject({ dueAt: '2026-10-22T17:00:00Z', submitted: true });
    expect(intro).toMatchObject({ course: 'AE Advising', submitted: true });
    expect(reading).toMatchObject({ submitted: true });
    expect(exam).toMatchObject({ submitted: true });
  });

  it('produces items Polaris accepts and tags by course', () => {
    const parsed = parseSyncBatch({ kind: 'canvas', items: toItems(planner, [course]) });
    expect(parsed?.rejected).toEqual([]);
    const { data } = applySync(emptyData(), parsed!.batch, testCtx());
    expect(data.tags.map((t) => t.name)).toEqual(['AE 370', 'AE Advising']);
  });

  it('reads the next-page link', () => {
    const link = '<https://canvas.illinois.edu/api/v1/x?page=1>; rel="current", <https://canvas.illinois.edu/api/v1/x?page=2>; rel="next"';
    expect(nextPageUrl(link)).toBe('https://canvas.illinois.edu/api/v1/x?page=2');
    expect(nextPageUrl('<https://a/x>; rel="last"')).toBeNull();
    expect(nextPageUrl(null)).toBeNull();
  });
});

function fakeFetch(pages: Record<string, { body: unknown; link?: string; status?: number; url?: string }>) {
  return (async (input: string) => {
    const key = Object.keys(pages).find((k) => input.includes(k));
    const page = key ? pages[key]! : { body: [], status: 404 };
    return {
      ok: (page.status ?? 200) < 400,
      status: page.status ?? 200,
      redirected: false,
      url: page.url ?? input,
      headers: new Headers(page.link ? { link: page.link } : {}),
      text: async () => `while(1);${JSON.stringify(page.body)}`,
    };
  }) as unknown as typeof fetch;
}

describe('fetching from Canvas', () => {
  const now = new Date('2026-10-18T12:00:00Z');

  it('follows pages, strips the JSON prefix and marks a complete fetch with its window', async () => {
    const batch = await fetchCanvasBatch(
      fakeFetch({
        '/planner/items?per_page': { body: [planner[0]], link: '<https://canvas.illinois.edu/api/v1/planner/items?page=2>; rel="next"' },
        '/planner/items?page=2': { body: [planner[1]] },
        '/courses?': { body: [course] },
      }),
      now,
    );
    expect(batch.items.map((i) => i.title)).toEqual(['Homework 5', 'Quiz 3']);
    expect(batch.window).toEqual({ start: '2026-10-04T12:00:00.000Z', end: '2027-02-15T12:00:00.000Z' });
    expect(batch.fetchedAt).toBe('2026-10-18T12:00:00.000Z');
    expect(parseSyncBatch(batch)?.batch.fetchedAt).toBe(batch.fetchedAt);
  });

  it('reports a signed-out user clearly', async () => {
    const fetchImpl = fakeFetch({ '/planner/items': { body: {}, status: 401 }, '/courses?': { body: [] } });
    await expect(fetchCanvasBatch(fetchImpl, now)).rejects.toBeInstanceOf(SignedOutError);
  });

  it('treats a redirect to the login page as signed out', async () => {
    const fetchImpl = fakeFetch({
      '/planner/items': { body: [], url: 'https://canvas.illinois.edu/login/saml' },
      '/courses?': { body: [] },
    });
    await expect(fetchCanvasBatch(fetchImpl, now)).rejects.toBeInstanceOf(SignedOutError);
  });
});
