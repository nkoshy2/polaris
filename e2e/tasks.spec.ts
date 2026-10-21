import { expect, goToAllTasks, pickFilter, quickAdd, row, test } from './fixtures';

test('create, edit, complete, reopen and delete a task', async ({ app: page }) => {
  await quickAdd(page, 'Renew passport');
  await expect(page.getByRole('status').filter({ hasText: 'Added “Renew passport”' })).toBeVisible();

  await goToAllTasks(page);
  await row(page, 'Renew passport').getByRole('button', { name: 'Renew passport' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit task' });
  await dialog.getByLabel('Title').fill('Renew passport online');
  await dialog.getByRole('button', { name: 'Tomorrow' }).click();
  await dialog.getByRole('radio', { name: /High/ }).check();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  const r = row(page, 'Renew passport online');
  await expect(r).toContainText('Due tomorrow');
  await expect(r).toContainText('High importance');

  // Complete: the task leaves the "Open" list and focus stays in the list area.
  // click(), not check(): the row leaves the list, so its checked state can't be read back.
  await r.getByRole('checkbox', { name: 'Complete “Renew passport online”' }).click();
  await expect(r).toHaveCount(0);
  await expect(page.getByText('Everything here is completed.')).toBeVisible();

  // Reopen from the Completed filter.
  await pickFilter(page, 'Status', 'Completed');
  const done = row(page, 'Renew passport online');
  await expect(done).toContainText('Completed');
  await done.getByRole('checkbox').click();
  await expect(done).toHaveCount(0);
  await pickFilter(page, 'Status', 'Open');
  await expect(row(page, 'Renew passport online')).toBeVisible();

  // Delete (with confirmation) and undo.
  await row(page, 'Renew passport online').getByRole('button', { name: 'Renew passport online' }).click();
  await page.getByRole('button', { name: 'Delete…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Yes, delete' }).click();
  await expect(row(page, 'Renew passport online')).toHaveCount(0);
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, 'Renew passport online')).toBeVisible();
});

test('rejects an empty title with an accessible error and keeps data unchanged', async ({ app: page }) => {
  await page.getByLabel('New task').press('Enter');
  const error = page.getByRole('alert').filter({ hasText: "Title can't be empty." });
  await expect(error).toBeVisible();
  await expect(page.getByLabel('New task')).toHaveAttribute('aria-invalid', 'true');

  await quickAdd(page, 'Keep me');
  await goToAllTasks(page);
  await row(page, 'Keep me').getByRole('button', { name: 'Keep me' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit task' });
  await dialog.getByLabel('Title').fill('   ');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(/Title can't be empty/);
  await expect(dialog.getByLabel('Title')).toBeFocused();

  // Cancelling with unsaved changes asks before discarding.
  await page.keyboard.press('Escape');
  await expect(dialog.getByText('You have unsaved changes. Discard them?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Discard changes' }).click();
  await expect(dialog).toBeHidden();
  await expect(row(page, 'Keep me')).toBeVisible();
});

test('steps: progress, inline completion, and parent rules', async ({ app: page }) => {
  await page.getByRole('button', { name: 'Add with details…' }).click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await dialog.getByLabel('Title').fill('Move house');
  await dialog.getByRole('radio', { name: /High/ }).check();
  for (const step of ['Book van', 'Pack boxes', 'Update address']) {
    await dialog.getByLabel('New step').fill(step);
    await dialog.getByLabel('New step').press('Enter');
  }
  await dialog.getByRole('button', { name: 'Add task' }).click();

  const r = row(page, 'Move house');
  await expect(r).toContainText('0 of 3 steps');
  await r.getByRole('button', { name: /0 of 3 steps/ }).click();
  await r.getByRole('checkbox', { name: 'Book van' }).check();
  await expect(r).toContainText('1 of 3 steps');

  // Completing the task completes all steps.
  await goToAllTasks(page);
  await pickFilter(page, 'Status', 'Open and completed');
  const all = row(page, 'Move house');
  await all.getByRole('checkbox', { name: 'Complete “Move house”' }).check();
  await expect(all).toContainText('3 of 3 steps');

  // Unchecking a step reopens the task.
  await all.getByRole('button', { name: /3 of 3 steps/ }).click();
  await all.getByRole('checkbox', { name: 'Pack boxes' }).uncheck();
  await expect(all.getByRole('checkbox', { name: 'Complete “Move house”' })).not.toBeChecked();
  await expect(page.getByText('Reopened “Move house” because a step is unfinished.')).toBeVisible();

  // Progress summary counts the task once, never its steps.
  await expect(page.locator('#scope-progress')).toContainText('0 of 1 task completed (0%)');
});

test('duplicate creates an open copy', async ({ app: page }) => {
  await quickAdd(page, 'Weekly review');
  await goToAllTasks(page);
  await row(page, 'Weekly review').getByRole('button', { name: 'Weekly review' }).click();
  await page.getByRole('button', { name: 'Duplicate' }).click();
  await expect(row(page, 'Weekly review (copy)')).toBeVisible();
  await expect(row(page, 'Weekly review')).toBeVisible();
});

test('bulk complete and bulk delete selected tasks', async ({ app: page }) => {
  for (const t of ['One', 'Two', 'Three']) await quickAdd(page, t);
  await goToAllTasks(page);
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await row(page, 'One').getByRole('checkbox', { name: 'Select “One”' }).check();
  await row(page, 'Two').getByRole('checkbox', { name: 'Select “Two”' }).check();
  await expect(page.getByText('2 selected')).toBeVisible();
  await page.getByRole('group', { name: 'Bulk actions' }).getByRole('button', { name: 'Complete' }).click();
  await expect(page.locator('#scope-progress')).toContainText('2 of 3 tasks completed (66%)');
  await expect(row(page, 'One')).toHaveCount(0);

  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select all shown' }).check();
  await page.getByRole('button', { name: 'Delete…' }).click();
  await page.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(page.locator('#scope-progress')).toContainText('2 of 2 tasks completed (100%)');
  await page.keyboard.press('Control+z');
  await expect(row(page, 'Three')).toBeVisible();
});

test('quick-add shorthand sets the date, importance and tags, with a preview first', async ({ app: page }) => {
  const input = page.getByLabel('New task');
  await input.fill('Call plumber tomorrow !high #Home');
  const preview = page.locator('#quick-add-preview');
  await expect(preview).toContainText('Adds “Call plumber”');
  await expect(preview).toContainText('High importance');
  await expect(preview).toContainText('Home (new tag)');
  await input.press('Enter');
  await expect(input).toHaveValue('');

  await expect(page.getByRole('region', { name: /This week/ })).toContainText('Call plumber');
  await goToAllTasks(page);
  const r = row(page, 'Call plumber');
  await expect(r).toContainText('Due tomorrow');
  await expect(r).toContainText('High importance');
  await expect(r).toContainText('Home');

  // A second #home reuses the tag instead of creating another.
  await input.fill('Fix fence #home');
  await expect(page.locator('#quick-add-preview')).not.toContainText('new tag');
});
