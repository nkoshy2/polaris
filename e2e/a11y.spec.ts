import { expect, expectNoA11yViolations, goToAllTasks, openNavIfCollapsed, quickAdd, row, test } from './fixtures';

async function seedVariety(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Add with details…' }).click();
  const d = page.getByRole('dialog', { name: 'New task' });
  await d.getByLabel('Title').fill('Overdue thing');
  await d.getByLabel('Due date', { exact: true }).fill('2026-10-10');
  await d.getByRole('radio', { name: /High/ }).check();
  await d.getByLabel('New tag name').fill('Work');
  await d.getByRole('button', { name: 'Create tag' }).click();
  await d.getByLabel('New step').fill('A step');
  await d.getByRole('button', { name: 'Add step' }).click();
  await d.getByRole('button', { name: 'Add task' }).click();
  await quickAdd(page, 'Plain task');
}

test('no automatically detectable WCAG A/AA violations across views and dialogs', async ({ app: page }) => {
  await expectNoA11yViolations(page); // empty state
  await seedVariety(page);
  await expectNoA11yViolations(page); // Focus with content + toast

  await goToAllTasks(page);
  await page.getByLabel('Status', { exact: true }).selectOption('all');
  await row(page, 'Overdue thing').getByRole('button', { name: /steps/ }).click();
  await expectNoA11yViolations(page);

  await page.getByRole('button', { name: 'Select' }).click();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Done selecting' }).click();

  await row(page, 'Overdue thing').getByRole('button', { name: 'Overdue thing' }).click();
  await expectNoA11yViolations(page, 'dialog');
  await page.keyboard.press('Escape');

  await openNavIfCollapsed(page);
  await page.getByRole('button', { name: 'Manage' }).click();
  await expectNoA11yViolations(page, 'dialog');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Backup', exact: true }).click();
  await expectNoA11yViolations(page, 'dialog');
});

test('core workflow is keyboard-only operable with visible focus and focus return', async ({ app: page, isMobile }) => {
  test.skip(isMobile, 'Keyboard shortcuts are a desktop workflow.');
  // "n" jumps to the new-task field.
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('n');
  await expect(page.getByLabel('New task')).toBeFocused();
  await page.keyboard.type('Keyboard task');
  await page.keyboard.press('Enter');

  await page.keyboard.press('Escape'); // no-op outside dialogs
  await page.getByRole('link', { name: /All tasks/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'All tasks' })).toBeFocused();

  // Tab to the task title and open it with Enter.
  const title = row(page, 'Keyboard task').getByRole('button', { name: 'Keyboard task' });
  await title.focus();
  const outline = await title.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Edit task' });
  await expect(dialog.getByLabel('Title')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(title).toBeFocused();

  // Complete with Space on the checkbox; focus stays inside the list area.
  await row(page, 'Keyboard task').getByRole('checkbox').focus();
  await page.keyboard.press('Space');
  await expect(row(page, 'Keyboard task')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'All tasks' })).toBeFocused();

  // "/" focuses search; Ctrl+Z undoes the completion.
  await page.keyboard.press('Control+z');
  await expect(row(page, 'Keyboard task')).toBeVisible();
  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox', { name: 'Search tasks' })).toBeFocused();
});

test('status changes are announced through live regions', async ({ app: page }) => {
  await quickAdd(page, 'Announce me');
  await expect(page.locator('[role=status]').filter({ has: page.locator('.toast-list') })).toContainText('Added “Announce me”');
});

test('respects reduced motion', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/');
  await quickAdd(page, 'Calm');
  const duration = await page.locator('.toast').first().evaluate((el) => getComputedStyle(el).animationDuration);
  expect(parseFloat(duration)).toBeLessThan(0.01);
  await context.close();
});

test('mobile layout: navigation collapses behind a toggle and nothing overflows', async ({ app: page, isMobile }) => {
  test.skip(!isMobile, 'Mobile-only check.');
  const nav = page.getByRole('navigation', { name: 'Views' });
  await expect(nav).toBeHidden();
  await page.getByRole('button', { name: 'Views and tags' }).click();
  await expect(nav).toBeVisible();
  await nav.getByRole('link', { name: /All tasks/ }).click();
  await expect(nav).toBeHidden();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
