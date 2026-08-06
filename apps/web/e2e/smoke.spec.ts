import { expect, test } from '@playwright/test';

test('health endpoint responds without local data', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.ok).toBe(true);
});

test('home page renders and navigates to tasks', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('会话浏览').first()).toBeVisible();
  await page.goto('/tasks');
  await expect(page.getByText(/任务验证/).first()).toBeVisible();
});
