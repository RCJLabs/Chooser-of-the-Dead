import { expect, test } from '@playwright/test';

test('web demo boots with demo content only', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('./');
  await expect(page).toHaveTitle('Chooser of the Slain');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Chooser of the Slain');
  await expect(page.getByTestId('target')).toHaveText('web-demo');
  await expect(page.getByTestId('edition')).toHaveText('demo');
  await expect(page.getByTestId('packs')).toHaveText('core · daily · demo');
  await expect(page.getByTestId('play-daily')).toHaveText(/^(Daily Shift #\d+|Daily preview · \d{4}-\d\d-\d\d)$/);
  await expect(page.getByTestId('layout')).toHaveText(testInfo.project.name === 'phone' ? 'drawer' : 'desk');
  // The demo offers practice on Days 1-3 only.
  await expect(page.locator('[data-testid^="practice-"]')).toHaveCount(3);
  // Its five stamps, and no registry.
  await expect(page.locator('.title__keys')).toContainText('T feather · C compare');
  await expect(page.locator('.title__keys')).toContainText('1-5 stamps');

  // No missing string keys, no campaign content, no Case Lab.
  const body = await page.locator('body').innerText();
  expect(body).not.toContain('⟦');
  expect(body).not.toContain('Case Lab');
  expect(errors).toEqual([]);
});

test('practice Day 3 has every Day 1-3 tool and no missing text', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('practice-3').click();
  await expect(page.getByTestId('briefing-title')).toHaveText('Day 3 practice');
  await page.getByTestId('begin').click();
  const look = page.locator('.chip--look');
  while ((await look.count()) > 0) await look.first().click();
  await page.getByTestId('flip').click();
  while ((await look.count()) > 0) await look.first().click();
  await page.getByTestId('feather').click();
  if ((await page.locator('.shift--drawer').count()) > 0) {
    await page.locator('[data-tab="ravens"]').click();
    await page.getByTestId('judge').click();
  }
  await expect(page.locator('[data-dest]')).toHaveText([/Valhalla/, /Hel/, /Return/]);
  expect(await page.locator('body').innerText()).not.toContain('⟦');
});

test('web demo ships a PWA manifest', async ({ request }) => {
  const res = await request.get('manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest.short_name).toBe('Chooser');
  expect(manifest.scope).toBe('/Chooser-of-the-Dead/');
});

test('web demo registers its service worker (updates wait for the title screen)', async ({ page }) => {
  await page.goto('./');
  const script = await page.evaluate(async () => {
    // This file is typechecked without DOM types; the page has them.
    type Worker = { scriptURL: string } | null | undefined;
    type Registration = { active: Worker; installing: Worker; waiting: Worker } | undefined;
    const sw = (navigator as unknown as { serviceWorker: { getRegistration(): Promise<Registration> } }).serviceWorker;
    for (let i = 0; i < 50; i++) {
      const reg = await sw.getRegistration();
      const worker = reg?.active ?? reg?.installing ?? reg?.waiting;
      if (worker) return worker.scriptURL;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return null;
  });
  expect(script).toBe('http://localhost:4173/Chooser-of-the-Dead/sw.js');
});

test('a practice shift can be left from the pause screen', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('practice-2').click();
  await page.getByTestId('begin').click();
  await expect(page.getByTestId('soul-count')).toHaveText(/^Soul 1 of \d+$/);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('leave-note')).toHaveText('Leaving ends this practice shift.');
  await page.getByTestId('leave-shift').click();
  await expect(page.getByTestId('practice-2')).toBeVisible();
  await expect(page.getByTestId('soul-count')).toHaveCount(0);
});
