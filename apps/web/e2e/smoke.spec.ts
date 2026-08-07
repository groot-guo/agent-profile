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

test('task workspace uses bounded Session discovery instead of the full array', async ({
  page,
  request,
}) => {
  const requests: string[] = [];
  await page.route('**/*', (route) => {
    requests.push(route.request().url());
    route.continue();
  });

  await page.goto('/tasks');
  await expect(page.getByText(/任务验证/).first()).toBeVisible();

  const sessionUrls = requests.filter((url) => url.includes('/api/sessions'));
  const discoveryUrls = requests.filter((url) => url.includes('/api/session-discovery'));

  expect(sessionUrls.length).toBe(0);
  expect(discoveryUrls.length).toBeLessThanOrEqual(1);

  const discovery = await request.get('/api/session-discovery?limit=50');
  expect(discovery.ok()).toBe(true);
  const body = await discovery.json();
  expect(Array.isArray(body.sessions)).toBe(true);
  expect(body.sessions.length).toBeLessThanOrEqual(50);
  expect(typeof body.counts.total).toBe('number');
  expect(body.page.limit).toBeLessThanOrEqual(50);
});

test('task workspace renders at mobile width without layout overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tasks');
  await expect(page.getByText(/任务验证/).first()).toBeVisible();
  const sourcePicker = page.getByPlaceholder('从观测 Session 预填（可选）');
  await expect(sourcePicker).toBeVisible();
  await sourcePicker.click();
  await expect(sourcePicker).toBeFocused();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
