import AxeBuilder from '@axe-core/playwright';
import { campaignQueue, type Destination, ENGINE_MAJOR, type RunSave, type RunState, runContext } from '@cots/engine';
import { loadContent, scenarioSave } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';
import { FULL } from './urls';

/*
 * Day events (docs/tech-spec.md §52) in the full game, from saves made in Node with every soul judged rightly and the
 * day's event set on its morning:
 * - Sickness in the valley (Day 6): the morning says what it brings; the night says it may reach the house whatever
 *   the bills, and the bills' own warning stays quiet while they're all paid.
 * - The jarl's feast (Day 7): three souls fewer at the gate, and tonight food costs nothing.
 */

test.use({ baseURL: FULL });

const content = loadContent('dev-full');

/** A save on the morning of `day`, its run having drawn `id` for that day and nothing else. */
function eventSave(seed: string, day: number, id: string): { save: RunSave; morning: RunState } {
  const base = scenarioSave(content, seed, day, ENGINE_MAJOR);
  const morning: RunState = { ...(base.mornings.at(-1) as RunState), events: [{ day, id }] };
  return { save: { ...base, mornings: [...base.mornings.slice(0, -1), morning] }, morning };
}

async function load(page: Page, save: RunSave) {
  await page.addInitScript(
    (record) => localStorage.setItem('cots.campaign.0', record),
    JSON.stringify({ v: 1, rev: 1, savedAt: 0, save }),
  );
  await page.goto('./');
  await page.getByTestId('play-campaign').click();
  await page.getByTestId('continue-0').click();
}

/** Plays the scenes showing through their first options: the day's own, then any letter from home (docs/tech-spec.md §74). */
async function playScene(page: Page) {
  await expect(page.getByTestId('scene')).toBeVisible();
  while ((await page.getByTestId('scene').count()) > 0) {
    const id = await page.getByTestId('scene').getAttribute('data-scene');
    while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
    await page.getByTestId('scene-done').click();
    await expect(page.locator(`[data-testid="scene"][data-scene="${id}"]`)).toHaveCount(0);
  }
}

const isDrawer = async (page: Page) => (await page.locator('.shift--drawer').count()) > 0;

/** Today's queue as saved in slot 0 once the gate opens: where each soul belongs, and what it needs done. */
async function savedQueue(page: Page) {
  const raw = await page.evaluate(() => localStorage.getItem('cots.campaign.0'));
  const record = JSON.parse(raw ?? 'null') as {
    save: { queue: { expect: { dest: Destination; procedures?: string[] } }[] | null };
  } | null;
  return record?.save.queue ?? [];
}

/** Every soul in today's line judged rightly (nails clipped where they must be), through to the audit. */
async function judgeAll(page: Page) {
  for (const c of await savedQueue(page)) {
    if (c.expect.procedures?.includes('proc.clip')) await page.getByTestId('clippers').click();
    if (await isDrawer(page)) await page.getByTestId('judge').click();
    await page.locator(`[data-dest="${c.expect.dest}"]`).click();
    await page.getByTestId('send').click();
  }
  await expect(page.getByTestId('audit-title')).toBeVisible();
}

async function expectAccessible(page: Page) {
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
}

test('sickness in the valley: the morning says so, and at night it may reach the house, bills paid or not', async ({
  page,
}) => {
  const { save } = eventSave('e2e-sickness', 6, 'event.sickness');
  await load(page, save);
  await expect(page.getByTestId('morning-title')).toHaveText('Day 6');
  await playScene(page);
  await expect(page.getByTestId('day-event-name')).toHaveText('Sickness in the valley');
  await expect(page.getByTestId('day-event')).toContainText('A coughing sickness is going round the valley.');
  await expect(page.getByTestId('day-event-sick')).toHaveText(
    'Tonight anyone well at home may catch it, whatever you pay for: 20% each.',
  );
  // As many souls as ever, and the same sun.
  await expect(page.getByTestId('day-event-line')).toHaveCount(0);
  await expect(page.getByTestId('day-event-sun')).toHaveCount(0);
  await expectAccessible(page);

  await page.getByTestId('to-gate').click();
  await judgeAll(page);
  await page.getByTestId('go-home').click();
  await expect(page.getByTestId('night-title')).toHaveText('Night 6');
  await playScene(page);
  await expect(page.getByTestId('event-night-sick')).toHaveText(
    'Sickness in the valley: Tonight anyone well at home may catch it, whatever you pay for: 20% each.',
  );
  // Every bill is paid: the bills themselves bring no risk.
  await expect(page.getByTestId('outlook-risk')).toHaveCount(0);
  await expectAccessible(page);
});

test('the jarl’s feast: three souls fewer at the gate, and tonight the family eats at his hall', async ({ page }) => {
  const { save, morning } = eventSave('e2e-feast', 7, 'event.feast');
  const without = { ...morning, events: [] };
  const souls = (r: RunState) => campaignQueue(r, { content, ctx: runContext(content, r) }).length;
  expect(souls(morning)).toBe(souls(without) - 3);
  await load(page, save);
  await expect(page.getByTestId('morning-title')).toHaveText('Day 7');
  await playScene(page);
  await expect(page.getByTestId('day-event-name')).toHaveText("The jarl's feast");
  await expect(page.getByTestId('day-event-line')).toHaveText('3 souls fewer in the line today.');
  await expect(page.getByTestId('day-event-bill-food')).toHaveText('Tonight food costs nothing.');

  await page.getByTestId('to-gate').click();
  await expect(page.getByTestId('soul-count')).toHaveText(`Soul 1 of ${souls(morning)}`);
  await judgeAll(page);
  await page.getByTestId('go-home').click();
  await playScene(page);
  await expect(page.getByTestId('event-night-bill-food')).toHaveText("The jarl's feast: Tonight food costs nothing.");
  await expect(page.getByTestId('bills')).toContainText('Food for 3 (0 rings)');
});
