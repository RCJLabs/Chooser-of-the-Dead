import { dailySeed, startShift } from '@cots/engine';
import { loadDailyContent } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';
import { FULL } from './urls';

/*
 * When something breaks (docs/tech-spec.md §63), in the dev build, whose hooks break things on purpose. A screen
 * that throws while drawing is replaced by one that says nothing saved is lost, with the sun paused first, and a
 * reload carries on from the last move. An error that doesn't break the screen gets a notice, once.
 */

test.use({ baseURL: FULL, timezoneId: 'UTC' });

// Daily #41 (DAILY_EPOCH is 2026-12-01).
const DATE = new Date('2027-01-10T12:00:00Z');
const N = 41;
const content = loadDailyContent();
const spec = content.daily;
if (!spec) throw new Error('No Daily in content');
const { state } = startShift(content, { mode: 'daily', seed: dailySeed(N), day: spec.day, dailyNumber: N });

/** Today's Daily, with its first soul judged and sent. */
async function firstSoulSent(page: Page) {
  await page.clock.setFixedTime(DATE);
  await page.goto('./');
  await page.getByTestId('play-daily').click();
  await expect(page.getByTestId('briefing-title')).toHaveText(`Daily Shift #${N}`);
  await page.getByTestId('begin').click();
  const first = state.cases[0];
  if (!first) throw new Error('An empty Daily');
  if ((await page.locator('.shift--drawer').count()) > 0) await page.getByTestId('judge').click();
  await page.locator(`[data-dest="${first.expect.dest}"]`).click();
  await page.getByTestId('send').click();
  await expect(page.getByTestId('soul-count')).toHaveText('Soul 2 of 8');
}

test('a screen that breaks says nothing saved is lost, pauses the sun, and a reload carries on', async ({ page }) => {
  await firstSoulSent(page);
  await page.evaluate(`window.cotsCrash('render')`);
  const crash = page.getByTestId('crash');
  await expect(crash).toBeVisible();
  await expect(crash).toContainText("Nothing you've saved is lost");
  await expect(page.getByTestId('crash-reload')).toBeFocused();

  // The report: the build, the error, and where the player was.
  const report = JSON.parse(await page.getByTestId('crash-text').inputValue()) as Record<string, unknown>;
  expect(report).toMatchObject({
    v: 1,
    kind: 'crash',
    message: 'Error: A test crash, from the lab',
    where: `shift · Daily #${N} · day ${spec.day} · soul 2 of 8`,
  });
  expect(report.build).toMatch(/^dev-full · /);
  const href = (await page.getByTestId('crash-report').getAttribute('href')) ?? '';
  expect(new URL(href).searchParams.get('template')).toBe('problem-report.yml');

  // The sun was paused before the screen went, and the pause is saved with the shift.
  expect(
    await page.evaluate(`JSON.parse(localStorage.getItem('cots.daily-progress') ?? 'null')?.actions.at(-1)?.t`),
  ).toBe('pause');

  await page.getByTestId('crash-reload').click();
  await expect(page.getByTestId('play-daily')).toHaveText("Resume today's shift");
  await page.getByTestId('play-daily').click();
  await page.getByTestId('resume').click();
  await expect(page.getByTestId('soul-count')).toHaveText('Soul 2 of 8');
});

test("an error that doesn't break the screen gets a notice, once, and the shift goes on", async ({ page }) => {
  await firstSoulSent(page);
  await page.evaluate(`window.cotsCrash('handler')`);
  const notice = page.getByTestId('problem');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('If the game stops responding, reload');
  const href = (await page.getByTestId('problem-report').getAttribute('href')) ?? '';
  const report = JSON.parse(new URL(href).searchParams.get('report') ?? 'null') as Record<string, unknown>;
  expect(report).toMatchObject({ kind: 'error', message: 'Error: A test problem, from the lab' });

  await page.getByTestId('problem-dismiss').click();
  await expect(notice).toHaveCount(0);
  // The same problem again isn't shown again.
  await page.evaluate(`window.cotsCrash('handler')`);
  await page.waitForTimeout(300);
  await expect(notice).toHaveCount(0);
  await expect(page.getByTestId('soul-count')).toHaveText('Soul 2 of 8');
  await expect(page.getByTestId('crash')).toHaveCount(0);
});
