/**
 * Feasibility checks for the Polaris Connector extension.
 *
 * Answers one question: can an MV3 extension read Canvas and Gradescope using
 * the user's existing browser sign-in (no tokens, no passwords)? Runs in both
 * the extension page and the service worker, because the real sync will run in
 * the service worker and Chrome may treat the two contexts differently.
 *
 * Uses only fetch and regex (no DOMParser), so it works in the service worker.
 * Results stay in the browser; nothing is sent anywhere else.
 */

export const CANVAS_ORIGIN = 'https://canvas.illinois.edu';
export const GRADESCOPE_ORIGIN = 'https://www.gradescope.com';

const SAMPLE_SIZE = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Canvas prefixes JSON with `while(1);` for cookie-authenticated requests. */
const CANVAS_JSON_PREFIX = /^while\(1\);/;

function describeResponse(response, text) {
  return {
    status: response.status,
    finalUrl: response.url,
    redirected: response.redirected,
    contentType: response.headers.get('content-type'),
    bytes: text.length,
  };
}

async function fetchText(url, accept) {
  const response = await fetch(url, { credentials: 'include', headers: { Accept: accept } });
  const text = await response.text();
  return { response, text };
}

function parseCanvasJson(text) {
  const hadPrefix = CANVAS_JSON_PREFIX.test(text);
  return { hadPrefix, value: JSON.parse(text.replace(CANVAS_JSON_PREFIX, '')) };
}

export async function checkCanvas() {
  const result = { source: 'Canvas', signedIn: false, steps: [] };
  try {
    const self = await fetchText(`${CANVAS_ORIGIN}/api/v1/users/self`, 'application/json');
    const selfStep = { name: 'GET /api/v1/users/self', ...describeResponse(self.response, self.text) };
    result.steps.push(selfStep);
    if (!self.response.ok) {
      result.verdict = `Not signed in or blocked (HTTP ${self.response.status}).`;
      return result;
    }
    const user = parseCanvasJson(self.text);
    selfStep.hadWhile1Prefix = user.hadPrefix;
    result.signedIn = true;
    result.userName = user.value.name;

    const start = new Date(Date.now() - 14 * DAY_MS).toISOString();
    const end = new Date(Date.now() + 60 * DAY_MS).toISOString();
    const plannerUrl =
      `${CANVAS_ORIGIN}/api/v1/planner/items?per_page=100` +
      `&start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}`;
    const planner = await fetchText(plannerUrl, 'application/json');
    const plannerStep = { name: 'GET /api/v1/planner/items', ...describeResponse(planner.response, planner.text) };
    result.steps.push(plannerStep);
    if (!planner.response.ok) {
      result.verdict = `Signed in, but planner items failed (HTTP ${planner.response.status}).`;
      return result;
    }
    const items = parseCanvasJson(planner.text);
    plannerStep.hadWhile1Prefix = items.hadPrefix;
    plannerStep.hasNextPage = /rel="next"/.test(planner.response.headers.get('link') ?? '');

    const list = Array.isArray(items.value) ? items.value : [];
    const byType = {};
    for (const item of list) byType[item.plannable_type] = (byType[item.plannable_type] ?? 0) + 1;
    result.itemCount = list.length;
    result.itemsByType = byType;
    result.sample = list.slice(0, SAMPLE_SIZE).map((item) => ({
      course: item.context_name ?? null,
      title: item.plannable?.title ?? null,
      type: item.plannable_type,
      due: item.plannable?.due_at ?? item.plannable_date ?? null,
      submitted: item.submissions ? Boolean(item.submissions.submitted) : null,
    }));
    result.verdict = `Works: read ${list.length} planner items for ${result.userName}.`;
  } catch (error) {
    result.verdict = `Failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  return result;
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&nbsp;': ' ' };
const decodeEntities = (s) => s.replace(/&(?:amp|lt|gt|quot|nbsp|#39|#x27);/g, (m) => ENTITIES[m]).trim();

/** Gradescope's dashboard: course cards link to /courses/<id> and show a short name. */
const COURSE_CARD = /href="\/courses\/(\d+)"[\s\S]*?courseBox--shortname[^>]*>([^<]*)</g;

function looksSignedOut(response, html) {
  const path = new URL(response.url).pathname;
  return path === '/login' || path === '/' || /name="session\[password\]"/.test(html);
}

export async function checkGradescope() {
  const result = { source: 'Gradescope', signedIn: false, steps: [] };
  try {
    const account = await fetchText(`${GRADESCOPE_ORIGIN}/account`, 'text/html');
    result.steps.push({ name: 'GET /account', ...describeResponse(account.response, account.text) });
    if (!account.response.ok || looksSignedOut(account.response, account.text)) {
      result.verdict = 'Not signed in: Gradescope sent the login page.';
      return result;
    }
    result.signedIn = true;

    const courses = [...account.text.matchAll(COURSE_CARD)].map((m) => ({ id: m[1], name: decodeEntities(m[2]) }));
    result.courses = courses;
    const first = courses[0];
    if (!first) {
      result.verdict = 'Signed in, but no course cards were recognised on the dashboard (layout may differ).';
      return result;
    }

    const course = await fetchText(`${GRADESCOPE_ORIGIN}/courses/${first.id}`, 'text/html');
    result.steps.push({ name: `GET /courses/${first.id}`, ...describeResponse(course.response, course.text) });
    const html = course.text;
    result.firstCourse = {
      name: first.name,
      tableRows: (html.match(/<tr[^>]*role="row"/g) ?? []).length,
      dueDates: [...html.matchAll(/submissionTimeChart--dueDate[^>]*datetime="([^"]+)"/g)].map((m) => m[1]).slice(0, SAMPLE_SIZE),
      submittedCount: (html.match(/submissionStatus--text">\s*Submitted/g) ?? []).length,
      noSubmissionCount: (html.match(/No Submission/g) ?? []).length,
    };
    result.verdict = `Works: found ${courses.length} courses; first course page loaded.`;
  } catch (error) {
    result.verdict = `Failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  return result;
}

export async function runChecks() {
  const [canvas, gradescope] = await Promise.all([checkCanvas(), checkGradescope()]);
  return { ranAt: new Date().toISOString(), canvas, gradescope };
}
