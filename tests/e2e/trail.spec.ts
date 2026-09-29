import AxeBuilder from '@axe-core/playwright';
import { type CaseSpec, culpritOf, ENGINE_MAJOR, type RunSave, resumeSave, suspectsLeft, trailOf } from '@cots/engine';
import { loadContent, scenarioSave } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';
import { FULL } from './urls';

/*
 * The forger's trail (docs/tech-spec.md §71) in the full game, from saves made in Node with every soul judged rightly
 * and every forged tally put under the lens, as a careful player does:
 * - Night 11: the letter asks for the carver's name, and the board opens with what Day 11 pinned.
 * - Night 12: the marks leave one carver; he's named, once, asked twice, and on Day 13 he's at the desk, drowned.
 */

test.use({ baseURL: FULL });

const content = loadContent('dev-full');
const def = trailOf(content);
if (!def) throw new Error('no forger’s trail');
const nameOf = (s: { look: { name: string; patronym: string } }) => `${s.look.name} ${s.look.patronym}`;
// Night 11's letter, answered by asking for his name, as a scene played before the save stands for.
const asked = { 'scene.d11.night': [{ flag: 'hunt_carver' }, { standing: 'odin' as const, by: 1 }] };
const marksOn = (save: RunSave) => resumeSave(save, content, ENGINE_MAJOR).run.trail?.marks ?? [];
// The first seed whose Day 11 pins two marks or more, and whose marks leave only the carver by Night 12. (A strict
// player's days hold fewer liars, and so fewer forged tallies, once the word among the dead goes stern: §73.)
const { SEED, night11, night12 } = (() => {
  for (let i = 0; i < 20; i++) {
    const seed = `e2e-trail-${i}`;
    const n11 = scenarioSave(content, seed, 11, ENGINE_MAJOR, 'night', { careful: true });
    if (marksOn(n11).length < 2) continue;
    const n12 = scenarioSave(content, seed, 12, ENGINE_MAJOR, 'night', { careful: true, scenes: asked });
    if (suspectsLeft(def, marksOn(n12)).length !== 1) continue;
    return { SEED: seed, night11: n11, night12: n12 };
  }
  throw new Error('No seed in 20 pins two marks on Day 11 and leaves only the carver by Night 12');
})();
const culprit = culpritOf(def, SEED);

async function load(page: Page, save: RunSave) {
  await page.addInitScript(
    (record) => localStorage.setItem('cots.campaign.0', record),
    JSON.stringify({ v: 1, rev: 1, savedAt: 0, save }),
  );
  await page.goto('./');
  await page.getByTestId('play-campaign').click();
  await page.getByTestId('continue-0').click();
}

async function expectAccessible(page: Page) {
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
}

async function finishScene(page: Page) {
  while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
  await page.getByTestId('scene-done').click();
}

const purse = async (page: Page) => Number((await page.getByTestId('night-rings').textContent())?.match(/\d+/)?.[0]);

test('Night 11: asking for the carver’s name opens the board, with what the desk pinned that day', async ({ page }) => {
  const marks = marksOn(night11);
  expect(marks.length).toBeGreaterThanOrEqual(2);
  const left = suspectsLeft(def, marks);
  await load(page, night11);
  await expect(page.getByTestId('night-title')).toHaveText('Night 11');
  // No board before the letter asks for his name.
  await expect(page.getByTestId('trail')).toHaveCount(0);
  await page.getByTestId('scene-choice').filter({ hasText: "Ask for the carver's name." }).click();
  await expect(page.getByTestId('scene')).toContainText('Every knife has its habits');
  await finishScene(page);

  const board = page.getByTestId('trail');
  await expect(board.getByRole('heading', { name: 'The carvers' })).toBeVisible();
  await expect(board.getByTestId('trail-carver')).toHaveCount(def.suspects.length);
  // Day 11's marks, pinned before the hunt opened, and who they leave.
  await expect(board.getByTestId('trail-marks')).toHaveText(`Pinned: ${marks.length} marks.`);
  await expect(board.locator('[data-testid="trail-carver"][data-possible="yes"]')).toHaveCount(left.length);
  await expect(board.locator(`[data-carver="${culprit.id}"]`)).toHaveAttribute('data-possible', 'yes');
  // Not a night to name him: when he can be.
  await expect(board.getByRole('button', { name: /as the carver/ })).toHaveCount(0);
  await expect(board.getByTestId('trail-when')).toHaveText(`You can name him on Night ${def.nights[0]}.`);
  await expectAccessible(page);
});

test('Night 12: the marks leave one carver, named once, asked twice, and drowned at the desk the next day', async ({
  page,
}) => {
  const marks = marksOn(night12);
  expect(suspectsLeft(def, marks)).toEqual([culprit]);
  await load(page, night12);
  await expect(page.getByTestId('night-title')).toHaveText('Night 12');
  await finishScene(page);

  const board = page.getByTestId('trail');
  await expect(board.getByTestId('trail-when')).toHaveText('Tonight you can name him. You get one name, once.');
  // Only the man the marks leave can be named; the others stay on the board, ruled out.
  await expect(board.getByRole('button', { name: /as the carver/ })).toHaveCount(1);
  await expect(board.locator('[data-testid="trail-carver"][data-possible="no"]')).toHaveCount(def.suspects.length - 1);
  const rings = await purse(page);
  // Asked twice: "not yet" takes it back.
  await board.getByTestId(`name-${culprit.id}`).click();
  await expect(board.getByTestId('trail-confirm')).toContainText(`Name ${nameOf(culprit)}?`);
  await expectAccessible(page);
  await board.getByTestId('trail-confirm-no').click();
  await expect(board.getByTestId('trail-confirm')).toHaveCount(0);
  await board.getByTestId(`name-${culprit.id}`).click();
  await board.getByTestId('trail-confirm-yes').click();

  const named = board.getByTestId('trail-named');
  await expect(named).toHaveAttribute('data-right', 'yes');
  await expect(named).toContainText(`You named ${nameOf(culprit)}.`);
  await expect(board.getByRole('button', { name: /as the carver/ })).toHaveCount(0);
  await expect(page.getByTestId('night-rings')).toContainText(`${rings + 15} rings`);
  // The right man named is an achievement, announced; scanned once it has faded in.
  const award = page.locator('.award');
  await expect(award).toContainText("The knife's habits");
  await page.evaluate(
    "Promise.all(document.querySelector('.award').getAnimations().map((a) => a.finished)).then(() => true)",
  );
  await expectAccessible(page);

  // The next day, at the desk: the carver, drowned at the jarl's order.
  await page.getByTestId('sleep').click();
  await expect(page.getByTestId('morning-title')).toHaveText('Day 13');
  await finishScene(page);
  await page.getByTestId('to-gate').click();
  const queue = await page.evaluate<CaseSpec[]>(
    `JSON.parse(localStorage.getItem('cots.campaign.0') ?? 'null')?.save.queue ?? []`,
  );
  const drowned = queue.find((c) => c.script === 'case.bjarni_drowned');
  expect(drowned?.evidence.look.name).toBe(culprit.look.name);
  expect(drowned?.expect.dest).toBe('RAN');
});
