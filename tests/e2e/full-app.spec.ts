import { expect, test } from '@playwright/test';
import { FULL_APP } from './urls';

/*
 * The whole game as Pages serves it at /full/ (web-full, docs/tech-spec.md §65): installable as its own app beside the
 * demo, with the playtest build's saves, and playable offline once visited.
 */

test.use({ baseURL: FULL_APP });

test('installs as its own app, named apart from the demo', async ({ request }) => {
  const res = await request.get('manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest).toMatchObject({
    name: 'Chooser of the Slain (Playtest)',
    short_name: 'Chooser Full',
    start_url: './',
    scope: './',
    display: 'standalone',
  });
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  // The rune font is cached with the rest, so runes read offline too.
  expect(await (await request.get('sw.js')).text()).toMatch(/noto-sans-runic[^"]*\.woff2/);
});

test('keeps what the playtest build keeps, and plays offline once visited', async ({ page, context }) => {
  await page.goto('./');
  await expect(page.getByTestId('playtest-note')).toContainText('Playtest build web-full · ');
  // Its own worker, at its own path: on Pages, /full/sw.js, apart from the demo's.
  const script = await page.evaluate(async () => {
    // This file is typechecked without DOM types; the page has them.
    type Registration = { active: { scriptURL: string } | null };
    const sw = (navigator as unknown as { serviceWorker: { ready: Promise<Registration> } }).serviceWorker;
    return (await sw.ready).active?.scriptURL ?? null;
  });
  expect(script).toBe(`${FULL_APP}sw.js`);

  // The same keys and database as the playtest build, so a tester who played /full/ before keeps their saves.
  await page.getByTestId('play-campaign').click();
  await page.getByTestId('new-0').click();
  await expect(page.getByTestId('morning-title')).toHaveText('Day 1');
  expect(await page.evaluate(() => localStorage.getItem('cots.playtest.campaign.0') !== null)).toBe(true);
  const databases = await page.evaluate<(string | undefined)[]>(
    '(async () => (await indexedDB.databases()).map((d) => d.name))()',
  );
  expect(databases).toContain('chooser-of-the-slain.playtest');

  // Offline, from its own cache: the next load is the worker's, then the network goes.
  await page.goto('./');
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Chooser of the Slain');
  await expect(page.getByTestId('playtest-note')).toContainText('Playtest build web-full · ');
  await page.getByTestId('play-campaign').click();
  await expect(page.getByTestId('continue-0')).toBeVisible();
  await context.setOffline(false);
});
