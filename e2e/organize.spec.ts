import { expect, goToAllTasks, openNavIfCollapsed, quickAdd, row, test } from './fixtures';

test('tags: create, assign, filter, find untagged, rename and delete without losing tasks', async ({ app: page }) => {
  await quickAdd(page, 'Draft budget');
  await quickAdd(page, 'Call plumber');

  await openNavIfCollapsed(page);
  await page.getByRole('button', { name: 'Manage' }).click();
  const tags = page.getByRole('dialog', { name: 'Tags' });
  await tags.getByLabel('New tag').fill('Finance');
  await tags.getByRole('button', { name: 'Create' }).click();
  await tags.getByLabel('New tag').fill('finance');
  await tags.getByRole('button', { name: 'Create' }).click();
  await expect(tags.getByRole('alert')).toHaveText(/already exists/);
  await page.keyboard.press('Escape');
  await expect(tags).toBeHidden();

  await goToAllTasks(page);
  await row(page, 'Draft budget').getByRole('button', { name: 'Draft budget' }).click();
  await page.getByRole('dialog').getByRole('checkbox', { name: 'Finance' }).check();
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(row(page, 'Draft budget')).toContainText('Finance');

  const nav = page.getByRole('navigation', { name: 'Views' });
  await openNavIfCollapsed(page);
  await nav.getByRole('link', { name: /Finance/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Finance' })).toBeVisible();
  await expect(page.locator('li.task')).toHaveCount(1);
  await expect(page.getByLabel('New task')).toBeVisible();
  await expect(page.locator('.quick-add-label')).toContainText('tagged Finance');

  await openNavIfCollapsed(page);
  await nav.getByRole('link', { name: /Untagged/ }).click();
  await expect(page.locator('li.task')).toHaveCount(1);
  await expect(row(page, 'Call plumber')).toBeVisible();

  // Rename, then delete the tag: the task survives and becomes untagged.
  await openNavIfCollapsed(page);
  await page.getByRole('button', { name: 'Manage' }).click();
  await tags.getByLabel('Name of tag Finance').fill('Money');
  await tags.getByRole('button', { name: 'Rename' }).click();
  await tags.getByRole('button', { name: 'Delete…' }).click();
  await expect(tags.getByText('It will be removed from 1 task; the tasks themselves are kept.')).toBeVisible();
  await tags.getByRole('button', { name: 'Delete tag' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('li.task')).toHaveCount(2);
});

test('search, filters, active-filter chips and reset', async ({ app: page }) => {
  await page.getByRole('button', { name: 'Add with details…' }).click();
  let dialog = page.getByRole('dialog', { name: 'New task' });
  await dialog.getByLabel('Title').fill('Submit grant application');
  await dialog.getByLabel('Notes').fill('Needs the café receipts');
  await dialog.getByRole('button', { name: 'Today' }).click();
  await dialog.getByRole('button', { name: 'Add task' }).click();
  await quickAdd(page, 'Water plants');

  // Typing in search jumps to All tasks.
  await page.getByRole('searchbox', { name: 'Search tasks' }).fill('cafe');
  await expect(page.getByRole('heading', { level: 1, name: 'All tasks' })).toBeVisible();
  await expect(page.locator('li.task')).toHaveCount(1);
  await expect(page.getByRole('status').filter({ hasText: 'Showing 1 task' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove filter Search: “cafe”' })).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search tasks' }).fill('zzz');
  await expect(page.getByText('No tasks match.')).toBeVisible();
  await page.getByRole('button', { name: 'clear all filters', exact: true }).click();
  await expect(page.locator('li.task')).toHaveCount(2);
  await expect(page.getByRole('searchbox', { name: 'Search tasks' })).toHaveValue('');

  await page.getByLabel('Due', { exact: true }).selectOption('today');
  await expect(page.locator('li.task')).toHaveCount(1);
  await page.getByLabel('Due', { exact: true }).selectOption('none');
  await expect(row(page, 'Water plants')).toBeVisible();
  await page.getByRole('button', { name: 'Remove filter Due: No due date' }).click();
  await expect(page.locator('li.task')).toHaveCount(2);

  await page.getByLabel('Sort by').selectOption('title');
  await page.getByLabel('Order').selectOption('desc');
  await expect(page.locator('li.task .task-title')).toHaveText(['Water plants', 'Submit grant application']);
});

test('Focus groups explain urgency vs importance and overview counts link to matching lists', async ({ app: page }) => {
  const add = async (title: string, opts: { date?: string; high?: boolean }) => {
    await page.getByRole('button', { name: 'Add with details…' }).click();
    const dialog = page.getByRole('dialog', { name: 'New task' });
    await dialog.getByLabel('Title').fill(title);
    if (opts.date) await dialog.getByLabel('Due date', { exact: true }).fill(opts.date);
    if (opts.high) await dialog.getByRole('radio', { name: /High/ }).check();
    await dialog.getByRole('button', { name: 'Add task' }).click();
    await expect(dialog).toBeHidden();
  };
  await add('Late invoice', { date: '2026-10-15' });
  await add('Dentist', { date: '2026-10-18' });
  await add('Big decision', { high: true });
  await add('Someday', {});

  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: /Overdue \(1\)/ })).toBeVisible();
  await expect(main.getByRole('heading', { name: /Due today \(1\)/ })).toBeVisible();
  await expect(main.getByRole('heading', { name: /^High importance \(1\)/ })).toBeVisible();
  await expect(row(page, 'Someday')).toHaveCount(0);
  await expect(row(page, 'Late invoice')).toContainText('Overdue by 3 days');

  await main.getByRole('button', { name: /^1\s*Overdue/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'All tasks' })).toBeVisible();
  await expect(page.locator('li.task .task-title')).toHaveText(['Late invoice']);
});
