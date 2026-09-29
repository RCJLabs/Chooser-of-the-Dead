import { campaignQueue, type Destination, ENGINE_MAJOR, type RunState, runContext } from '@cots/engine';
import { loadContent, scenarioSave } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';
import { FULL } from './urls';

/*
 * Promotion (docs/tech-spec.md §44) in the full game: a save on Day 6's morning, made in Node with Days 1-5
 * judged rightly, so the first rank is offered (from Day 6, §57). It's taken, the day is worked at it, and at night the rank is
 * stepped down from.
 */

test.use({ baseURL: FULL });

const content = loadContent('dev-full');
const save = scenarioSave(content, 'e2e-promotion', 6, ENGINE_MAJOR);
const morning = save.mornings[save.mornings.length - 1] as RunState;
const rank = content.campaign?.promotion?.ranks[0];
const ctx = runContext(content, morning);
const plainLine = campaignQueue(morning, { content, ctx }).length;
const wage = ctx.spec.economy?.wage ?? 0;

async function stampAndSend(page: Page, dest: Destination) {
  if ((await page.locator('.shift--drawer').count()) > 0) await page.getByTestId('judge').click();
  await page.locator(`[data-dest="${dest}"]`).click();
  await page.getByTestId('send').click();
}

test('a rank offered after clean days: taken in the morning, worked at the gate, stepped down from at night', async ({
  page,
}) => {
  if (!rank) throw new Error('no ranks in this build');
  expect(morning.offer).toBe(1);
  await page.addInitScript(
    (record) => localStorage.setItem('cots.campaign.0', record),
    JSON.stringify({ v: 1, rev: 1, savedAt: 0, save }),
  );
  await page.goto('./');
  await page.getByTestId('play-campaign').click();
  await page.getByTestId('continue-0').click();
  await expect(page.getByTestId('morning-title')).toHaveText('Day 6');
  while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
  await page.getByTestId('scene-done').click();

  // The offer says what the rank brings and costs.
  const card = page.getByTestId('promotion');
  await expect(card.locator('h2')).toHaveText('A promotion: Chooser, Second Grade');
  await expect(card).toContainText(
    `Each day would bring ${rank.souls} souls more than the day's own, one mistake fewer forgiven before the fines, ${rank.wage === 1 ? 'one ring' : `${rank.wage} rings`} more for each soul judged rightly, and a tithe to Odin of ${rank.tithe} rings each night.`,
  );
  const bills = Number((await page.getByTestId('tonight-bills').innerText()).match(/(\d+) rings/)?.[1] ?? 0);
  await page.getByTestId('promotion-take').click();
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId('rank')).toHaveText(' · Chooser, Second Grade');
  // Tonight's bills now count the tithe.
  await expect(page.getByTestId('tonight-bills')).toContainText(`${bills + rank.tithe} rings`);

  // A longer line, at the rank's wage.
  await page.getByTestId('to-gate').click();
  const total = plainLine + rank.souls;
  await expect(page.getByTestId('soul-count')).toHaveText(`Soul 1 of ${total}`);
  const saved = await page.evaluate<{ expect: { dest: Destination } }[]>(
    `JSON.parse(localStorage.getItem('cots.campaign.0') ?? 'null')?.save.queue ?? []`,
  );
  expect(saved).toHaveLength(total);
  for (const c of saved) await stampAndSend(page, c.expect.dest);
  await expect(page.getByTestId('audit-title')).toHaveText('Day 6: the audit');
  await expect(page.getByTestId('ledger')).toContainText(`Wages: ${total} judged rightly at ${wage + rank.wage} each`);

  // At night, the tithe among the bills, and the way back down.
  await page.getByTestId('go-home').click();
  await expect(page.getByTestId('night-rings')).toBeVisible();
  // The night's own scene, then your mother's letter (docs/tech-spec.md §74).
  while ((await page.getByTestId('scene').count()) > 0) {
    const id = await page.getByTestId('scene').getAttribute('data-scene');
    while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
    await page.getByTestId('scene-done').click();
    await expect(page.locator(`[data-testid="scene"][data-scene="${id}"]`)).toHaveCount(0);
  }
  await expect(page.getByTestId('tithe')).toHaveText(`Odin's tithe for the day's rank: ${rank.tithe} rings.`);
  await expect(page.getByTestId('ahead-tithe')).toHaveText(
    `Each of these nights, Odin's tithe too: ${rank.tithe} rings.`,
  );
  const after = async () =>
    Number((await page.getByTestId('after-bills').innerText()).match(/-?\d+/)?.[0] ?? Number.NaN);
  const withTithe = await after();
  await expect(page.getByTestId('rank-card')).toContainText(
    `Your rank: Chooser, Second Grade. Odin takes ${rank.tithe} rings a night for it.`,
  );
  await page.getByTestId('step-down').click();
  // From tomorrow: tonight's tithe is still owed for the day worked at the rank, the nights ahead owe none.
  await expect(page.getByTestId('stepped-down')).toHaveText(
    "You stepped down from Chooser, Second Grade, from tomorrow on. Tonight's tithe is still owed for the day worked at it.",
  );
  await expect(page.getByTestId('tithe')).toHaveText(`Odin's tithe for the day's rank: ${rank.tithe} rings.`);
  await expect(page.getByTestId('ahead-tithe')).toHaveCount(0);
  expect(await after()).toBe(withTithe);
});
