import type { Page } from '@playwright/test';
import { expect, expectNoA11yViolations, goToAllTasks, row, test } from './fixtures';

interface Item {
  externalId: string;
  title: string;
  submitted?: boolean;
  kind?: 'canvas' | 'gradescope';
  course?: string;
}

/** Posts a message the way the extension's content script does. Deadlines are 11:59 PM local on Oct 24. */
async function fromConnector(page: Page, message: Record<string, unknown>) {
  await page.evaluate((msg) => window.postMessage({ from: 'polaris-connector', ...msg }, location.origin), message);
}

async function sendBatch(page: Page, kind: 'canvas' | 'gradescope', items: Item[]) {
  await page.evaluate(
    ({ kind, items }) => {
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
      };
      window.postMessage({ from: 'polaris-connector', type: 'batch', batch }, location.origin);
    },
    { kind, items },
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
