import { readFile } from 'node:fs/promises';
import { expect, goToAllTasks, quickAdd, row, test } from './fixtures';

test('data persists across reloads', async ({ app: page }) => {
  await quickAdd(page, 'Survives restart');
  await page.reload();
  await goToAllTasks(page);
  await expect(row(page, 'Survives restart')).toBeVisible();
});

test('export a backup and restore it, with undo', async ({ app: page }, testInfo) => {
  await quickAdd(page, 'Backed up task');
  await page.getByRole('button', { name: 'Backup', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Backup & restore' });
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export backup' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('polaris-backup-2026-10-18.json');
  const file = testInfo.outputPath('backup.json');
  await download.saveAs(file);
  const json = JSON.parse(await readFile(file, 'utf8'));
  expect(json).toMatchObject({ app: 'polaris', schemaVersion: 1 });
  expect(json.data.tasks.map((t: { title: string }) => t.title)).toEqual(['Backed up task']);
  await page.keyboard.press('Escape');

  // Change data, then restore the backup.
  await quickAdd(page, 'Added after backup');
  await page.getByRole('button', { name: 'Backup', exact: true }).click();
  await dialog.getByLabel('Choose a backup file').setInputFiles(file);
  await expect(dialog.getByRole('region', { name: 'Restore preview' })).toContainText('contains 1 tasks (1 open) and 0 tags');
  await dialog.getByRole('button', { name: 'Replace my data' }).click();
  await goToAllTasks(page);
  await expect(page.locator('li.task .task-title')).toHaveText(['Backed up task']);

  await page.getByRole('banner').getByRole('button', { name: /Undo/ }).click();
  await expect(row(page, 'Added after backup')).toBeVisible();
});

test('rejects a file that is not a backup without touching data', async ({ app: page }, testInfo) => {
  await quickAdd(page, 'Precious');
  const bad = testInfo.outputPath('bad.json');
  await (await import('node:fs/promises')).writeFile(bad, '{"hello": "world"}');
  await page.getByRole('button', { name: 'Backup', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Backup & restore' });
  await dialog.getByLabel('Choose a backup file').setInputFiles(bad);
  await expect(dialog.getByRole('alert')).toHaveText(/not Polaris data/);
  await expect(dialog.getByRole('button', { name: 'Replace my data' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await goToAllTasks(page);
  await expect(row(page, 'Precious')).toBeVisible();
});

test('corrupt stored data: loads the previous copy, warns, and keeps a recovery copy', async ({ app: page }) => {
  await quickAdd(page, 'First');
  await quickAdd(page, 'Second');
  await page.evaluate(() => localStorage.setItem('polaris.data', '{"app":"polaris","schemaVersion":1,"data":{"tasks":[{'));
  await page.reload();

  await expect(page.getByRole('status').filter({ hasText: 'loaded the previous saved copy' })).toBeVisible();
  await goToAllTasks(page);
  await expect(row(page, 'First')).toBeVisible();

  await page.getByRole('button', { name: 'Backup', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Backup & restore' });
  await expect(dialog.getByRole('heading', { name: 'Recovery copy' })).toBeVisible();
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download recovery copy' }).click();
  expect((await download).suggestedFilename()).toMatch(/^polaris-recovery-/);
});

test('data from a newer version is never overwritten', async ({ app: page }) => {
  const future = JSON.stringify({ app: 'polaris', schemaVersion: 99, savedAt: '2027-01-01T00:00:00Z', data: {} });
  await page.evaluate((v) => localStorage.setItem('polaris.data', v), future);
  await page.reload();
  await expect(page.getByRole('alert').filter({ hasText: 'Read-only mode.' })).toBeVisible();
  await expect(page.getByLabel('New task')).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem('polaris.data'))).toBe(future);
});

test('changes made in another tab show up here', async ({ app: page, context }) => {
  const other = await context.newPage();
  await other.goto('/');
  await quickAdd(other, 'From the other tab');
  await goToAllTasks(page);
  await expect(row(page, 'From the other tab')).toBeVisible();
});
