import type { Destination } from '@cots/engine';
import { expect, type Page, test } from '@playwright/test';
import { PLAYTEST } from './urls';

/*
 * The build for invited playtesters (docs/playtest.md), served as itch.io serves it: it says which build it is,
 * keeps its saves apart from the public demo's, and turns a run into a report for the playtest form.
 */

test.use({ baseURL: PLAYTEST, permissions: ['clipboard-read', 'clipboard-write'] });

/** Where the playtest build keeps a slot; the demo keeps its own at `cots.campaign.N`. */
const slotKey = (slot: number) => `cots.playtest.campaign.${slot}`;

const drawer = (page: Page) =>
  page
    .locator('.shift--drawer')
    .count()
    .then((n) => n > 0);

async function stampAndSend(page: Page, dest: Destination) {
  if (await drawer(page)) await page.getByTestId('judge').click();
  await page.locator(`[data-dest="${dest}"]`).click();
  await page.getByTestId('send').click();
}

/** Today's queue as saved in a slot: where each soul belongs. */
async function savedAnswers(page: Page, slot: number): Promise<Destination[]> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), slotKey(slot));
  const record = JSON.parse(raw ?? 'null') as { save: { queue: { expect: { dest: Destination } }[] | null } } | null;
  return (record?.save.queue ?? []).map((c) => c.expect.dest);
}

/** Plays the scene on screen to its end, taking the first choice each time, and moves on. */
async function playScene(page: Page) {
  await expect(page.getByTestId('scene')).toBeVisible();
  while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
  await page.getByTestId('scene-done').click();
  await expect(page.getByTestId('scene')).toHaveCount(0);
}

test('the playtest build says so on the title, and keeps its saves apart from the demo', async ({ page }) => {
  // What the public demo would have left on the same origin: a slot this build can't read.
  await page.addInitScript(`localStorage.setItem('cots.campaign.0', '{"from":"the demo"}')`);
  await page.goto('./');
  await expect(page.getByTestId('playtest-note')).toContainText('Playtest build web-playtest · ');
  await page.getByTestId('play-campaign').click();
  // The demo's slot isn't this build's: slot 1 is free, not shown as a damaged save to clear.
  await expect(page.getByTestId('new-0')).toBeVisible();
  await expect(page.getByTestId('unreadable-0')).toHaveCount(0);
  await page.getByTestId('new-0').click();
  await expect(page.getByTestId('morning-title')).toHaveText('Day 1');
  expect(await page.evaluate((key) => localStorage.getItem(key) !== null, slotKey(0))).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('cots.campaign.0'))).toBe('{"from":"the demo"}');
  const databases = await page.evaluate<(string | undefined)[]>(
    '(async () => (await indexedDB.databases()).map((d) => d.name))()',
  );
  expect(databases).toContain('chooser-of-the-slain.playtest');
  expect(databases).not.toContain('chooser-of-the-slain');
});

test("a run's playtest report: the day in figures, the soul sent wrong and why, the choices made", async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('play-campaign').click();
  await expect(page.getByTestId('playtest-0')).toHaveCount(0);
  await page.getByTestId('new-0').click();
  await playScene(page);
  await page.getByTestId('to-gate').click();
  const [first, ...rest] = await savedAnswers(page, 0);
  await stampAndSend(page, first === 'HEL' ? 'VALHALLA' : 'HEL');
  await page.getByTestId('citation-close').click();
  for (const dest of rest) await stampAndSend(page, dest);
  await expect(page.getByTestId('audit-title')).toHaveText('Day 1: the audit');
  await page.getByTestId('go-home').click();
  await playScene(page);
  // The report reads back the choices the journal shows.
  await page.getByTestId('journal-open').click();
  const chosen = (await page.getByTestId('journal').locator('.scene__line--chosen').allTextContents()).map((s) =>
    s.trim(),
  );
  expect(chosen).toHaveLength(2);
  await page.getByTestId('journal-close').click();
  await page.getByTestId('sleep').click();
  await expect(page.getByTestId('morning-title')).toHaveText('Day 2');

  await page.reload();
  await page.getByTestId('play-campaign').click();
  await page.getByTestId('playtest-0').click();
  const dialog = page.getByTestId('playtest');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('playtest-close')).toBeFocused();
  const text = await page.getByTestId('playtest-text').inputValue();
  expect(text).toContain('- **Build:** web-playtest · local · content ');
  expect(text).toContain('- **Now:** Day 2, morning');
  // Day 1 with one soul sent wrong: its grade (docs/tech-spec.md §49), then the figures, with the sun left
  // when the last soul was sent (§63) and the claims pressed (none, §66).
  expect(text).toMatch(
    new RegExp(
      `^\\| 1 \\| steady \\(\\d+/\\d+ liars\\) \\| ${rest.length} \\| 1 \\| 0 \\| \\d+:\\d\\d \\| 0 \\| \\+${5 * rest.length} \\|`,
      'm',
    ),
  );
  const wrong = first === 'HEL' ? 'Valhalla' : 'Hel';
  const right = first === 'HEL' ? 'Hel' : 'Valhalla';
  expect(text).toMatch(
    new RegExp(`^- Day 1: stamped ${wrong} for a soul that belonged in ${right}\\. The rule: “[^”]+”`, 'm'),
  );
  expect(text).toContain(`- Day 1, morning: ${chosen[0]}`);
  expect(text).toContain(`- Day 1, night: ${chosen[1]}`);

  // The form opens with the report filled in.
  const form = new URL((await page.getByTestId('playtest-open').getAttribute('href')) ?? '');
  expect(form.searchParams.get('template')).toBe('campaign-playtest.yml');
  expect(form.searchParams.get('title')).toBe('Campaign playtest: Day 2');
  expect(form.searchParams.get('report')).toBe(text);

  await page.getByTestId('playtest-copy').click();
  await expect(page.getByTestId('playtest-copy')).toHaveText('Copied');
  expect(await page.evaluate<string>('navigator.clipboard.readText()')).toBe(text);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.getByTestId('playtest-0').click();
  await page.getByTestId('playtest-close').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('continue-0')).toBeVisible();
});
