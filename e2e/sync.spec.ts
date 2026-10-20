import type { Page } from '@playwright/test';
import { expect, expectNoA11yViolations, goToAllTasks, row, test } from './fixtures';

interface Item {
  externalId: string;
  title: string;
  submitted?: boolean;
  kind?: 'canvas' | 'gradescope';
  course?: string;
  dueAt?: string;
}

/** Posts a message the way the extension's content script does. Deadlines are 11:59 PM local on Oct 24. */
async function fromConnector(page: Page, message: Record<string, unknown>) {
  await page.evaluate((msg) => window.postMessage({ from: 'polaris-connector', ...msg }, location.origin), message);
}

async function sendBatch(page: Page, kind: 'canvas' | 'gradescope', items: Item[], fetchedAt?: string) {
  await page.evaluate(
    ({ kind, items, fetchedAt }) => {
      const dueAt = new Date(2026, 9, 24, 23, 59).toISOString();
      const batch = {
        kind,
        items: items.map((it) => ({
          kind,
          course: kind === 'canvas' ? 'Fall 2026-AE 370-Aerospace Numerical Methods-Section A' : 'ae_370_120268_1',
          url: `https://example.edu/${encodeURIComponent(it.externalId)}`,
          dueAt,
          submitted: false,
          ...it,
        })),
        ...(fetchedAt ? { fetchedAt } : {}),
      };
      window.postMessage({ from: 'polaris-connector', type: 'batch', batch }, location.origin);
    },
    { kind, items, fetchedAt },
  );
}

const hw = { externalId: 'canvas:canvas.illinois.edu:assignment:1', title: 'Homework 5' };

test('assignments from the extension become tagged tasks, one undoable change per sync', async ({ app: page }) => {
  await sendBatch(page, 'canvas', [hw, { externalId: 'canvas:canvas.illinois.edu:assignment:2', title: 'Lab 3' }]);
  await expect(page.getByRole('status').filter({ hasText: 'Canvas: added 2 assignments.' })).toBeVisible();

  await goToAllTasks(page);
  const r = row(page, 'Homework 5');
  await expect(r).toContainText('From Canvas');
  await expect(r).toContainText('AE 370');
  await expect(r).toContainText('Sat, Oct 24');

  await r.getByRole('button', { name: 'Homework 5' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit task' });
  await expect(dialog.getByRole('heading', { name: 'Assignment from Canvas' })).toBeVisible();
  await expect(dialog.getByRole('link', { name: /Open in Canvas/ })).toHaveAttribute('href', /^https:/);
  await expectNoA11yViolations(page, 'dialog');
  await page.keyboard.press('Escape');

  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, 'Homework 5')).toHaveCount(0);
});

test('a submission completes the task, and the same assignment in Gradescope is merged', async ({ app: page }) => {
  await sendBatch(page, 'canvas', [hw]);
  await sendBatch(page, 'gradescope', [{ ...hw, kind: 'gradescope', externalId: 'gradescope:assignment:77', submitted: true }]);
  await expect(page.getByRole('status').filter({ hasText: 'Gradescope: completed 1.' })).toBeVisible();

  await goToAllTasks(page);
  await page.getByLabel('Status', { exact: true }).selectOption('all');
  await expect(row(page, 'Homework 5')).toHaveCount(1);
  await expect(row(page, 'Homework 5')).toContainText('From Canvas and Gradescope');
  await expect(row(page, 'Homework 5')).toContainText('Completed');
});

test('saving an editor opened before a sync keeps the synced title and due date', async ({ app: page }) => {
  await sendBatch(page, 'canvas', [hw]);
  await goToAllTasks(page);
  await row(page, 'Homework 5').getByRole('button', { name: 'Homework 5' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit task' });
  await dialog.getByLabel('Notes').fill('Start early');

  // Upstream renames the assignment and moves its deadline while the editor is open.
  const oct26 = await page.evaluate(() => new Date(2026, 9, 26, 23, 59).toISOString());
  await sendBatch(page, 'canvas', [{ ...hw, title: 'Homework 5 (revised)', dueAt: oct26 }]);
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('Homework 5');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);

  const r = row(page, 'Homework 5 (revised)');
  await expect(r).toContainText('Mon, Oct 26');
  // The save didn't count as a user edit: sync still updates both fields.
  const oct28 = await page.evaluate(() => new Date(2026, 9, 28, 23, 59).toISOString());
  await sendBatch(page, 'canvas', [{ ...hw, title: 'Homework 5 (final)', dueAt: oct28 }]);
  await expect(row(page, 'Homework 5 (final)')).toContainText('Wed, Oct 28');
  await row(page, 'Homework 5 (final)').getByRole('button', { name: 'Homework 5 (final)' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit task' }).getByLabel('Notes')).toHaveValue('Start early');
});

test('a deleted assignment is not added again until it is allowed again', async ({ app: page }) => {
  await sendBatch(page, 'canvas', [hw]);
  await goToAllTasks(page);
  await row(page, 'Homework 5').getByRole('button', { name: 'Homework 5' }).click();
  await page.getByRole('button', { name: 'Delete…' }).click();
  await page.getByRole('button', { name: 'Delete task' }).click();
  await expect(row(page, 'Homework 5')).toHaveCount(0);

  await sendBatch(page, 'canvas', [hw]);
  await fromConnector(page, { type: 'hello', version: '0.1.0' });
  await page.getByRole('button', { name: 'Backup', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Canvas and Gradescope' })).toBeVisible();
  await expect(dialog).toContainText('version 0.1.0');
  await expect(dialog).toContainText('Gradescope: not synced yet');
  await expect(row(page, 'Homework 5')).toHaveCount(0);

  await dialog.getByText('1 deleted assignment won’t be added again').click();
  await expectNoA11yViolations(page, 'dialog');
  await dialog.getByRole('button', { name: 'Allow again for “Homework 5”' }).click();
  await page.keyboard.press('Escape');

  await sendBatch(page, 'canvas', [hw]);
  await expect(row(page, 'Homework 5')).toHaveCount(1);
});

test('shows sync failures reported by the extension, and ignores messages from other windows', async ({ app: page }) => {
  await fromConnector(page, { type: 'hello', version: '0.1.0' });
  await fromConnector(page, { type: 'status', kind: 'gradescope', ok: false, message: 'Not signed in to Gradescope.' });
  // A message that doesn't come from this page's own window (e.g. an embedded frame) is ignored.
  await page.evaluate(() => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    (frame.contentWindow as unknown as { eval(code: string): void }).eval(
      `parent.postMessage({ from: 'polaris-connector', type: 'batch', batch: { kind: 'canvas', items: [{ kind: 'canvas', externalId: 'canvas:x', title: 'Injected' }] } }, '*')`,
    );
  });

  await page.getByRole('button', { name: 'Backup', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Gradescope: sync failed');
  await expect(page.getByRole('dialog')).toContainText('Not signed in to Gradescope.');
  await page.keyboard.press('Escape');
  await goToAllTasks(page);
  await expect(row(page, 'Injected')).toHaveCount(0);
});

test('a failed sync shows a notice until that source syncs again, and replayed batches keep their fetch time', async ({ app: page }) => {
  // Relative to the page's fixed clock, not the test runner's.
  const pageNow = await page.evaluate(() => Date.now());
  const hoursAgo = (h: number) => new Date(pageNow - h * 3_600_000).toISOString();
  await fromConnector(page, { type: 'hello', version: '0.1.0' });
  // What the extension replays on page load: the cached failure, then the older cached batches.
  await fromConnector(page, { type: 'status', kind: 'gradescope', ok: false, message: 'Not signed in to Gradescope.', at: hoursAgo(1) });
  const canvasFetched = hoursAgo(3);
  await sendBatch(page, 'canvas', [hw], canvasFetched);
  await sendBatch(page, 'gradescope', [], hoursAgo(5));

  const notice = page.locator('.notice').filter({ hasText: 'Gradescope sync failed.' });
  await expect(notice).toHaveAttribute('role', 'status');
  await expect(notice).toContainText('Not signed in to Gradescope.');
  await expectNoA11yViolations(page);

  await notice.getByRole('button', { name: 'Open Backup' }).click();
  const dialog = page.getByRole('dialog', { name: 'Backup & restore' });
  await expect(dialog).toContainText('Gradescope: sync failed');
  const when = await page.evaluate((at) => new Date(at).toLocaleString(), canvasFetched);
  await expect(dialog).toContainText(`Canvas: synced ${when} (added 1 assignment)`);
  await page.keyboard.press('Escape');

  await sendBatch(page, 'gradescope', [], hoursAgo(0));
  await expect(notice).toHaveCount(0);
});
