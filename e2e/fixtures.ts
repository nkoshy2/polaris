import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type Page } from '@playwright/test';

export const TODAY = new Date('2026-10-18T10:00:00');

/** Each test gets a fresh browser context (empty storage) with a fixed clock. */
export const test = base.extend<{ app: Page }>({
  app: async ({ page }, use) => {
    await page.clock.setFixedTime(TODAY);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Focus' })).toBeVisible();
    await use(page);
  },
});

export { expect };

export async function quickAdd(page: Page, title: string) {
  const input = page.getByLabel('New task');
  await input.fill(title);
  await input.press('Enter');
  await expect(input).toHaveValue('');
}

export async function goToAllTasks(page: Page) {
  await openNavIfCollapsed(page);
  await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: /All tasks/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'All tasks' })).toBeVisible();
}

export async function openNavIfCollapsed(page: Page) {
  const toggle = page.getByRole('button', { name: 'Views and tags' });
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
}

export function row(page: Page, title: string) {
  return page.locator('li.task').filter({ has: page.getByRole('button', { name: title, exact: true }) });
}

export async function expectNoA11yViolations(page: Page, include?: string) {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => `${n.target.join(' ')} — ${n.failureSummary ?? ''}`).join('; ')})`,
  );
  expect(summary).toEqual([]);
}
