import AxeBuilder from '@axe-core/playwright';
import { type CaseSpec, type Destination, ENGINE_MAJOR, type RunSave, type RunState } from '@cots/engine';
import { loadContent, scenarioSave } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';
import { FULL } from './urls';

/*
 * Choose the slain (docs/tech-spec.md §78) in the full game, from a Day 16 save whose Ulf went up with the levy: at
 * dawn Skögul takes you over the pass, Ulf among the men to choose from. Chosen, he's gone from home, he comes to the
 * desk where Kari would have stood, and that night it's your mother who writes.
 */

test.use({ baseURL: FULL });

const content = loadContent('dev-full');

async function expectAccessible(page: Page) {
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
}

const isDrawer = async (page: Page) => (await page.locator('.shift--drawer').count()) > 0;

async function stampAndSend(page: Page, c: CaseSpec, dest: Destination = c.expect.dest) {
  if (c.expect.procedures?.includes('proc.clip')) await page.getByTestId('clippers').click();
  if (await isDrawer(page)) await page.getByTestId('judge').click();
  await page.locator(`[data-dest="${dest}"]`).click();
  await page.getByTestId('send').click();
}

/** Plays every scene showing through its first options. */
async function playScenes(page: Page) {
  while ((await page.getByTestId('scene').count()) > 0) {
    while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
    await page.getByTestId('scene-done').click();
  }
}

test('Day 16 at dawn: Ulf, chosen at the pass, comes to the desk, and that night your mother writes', async ({
  page,
}) => {
  // A Day 16 morning whose Ulf stayed home from the shipyard and went up with the levy on Night 15.
  const save = scenarioSave(content, 'e2e-slain', 16, ENGINE_MAJOR);
  const morning = save.mornings.at(-1) as RunState;
  expect(morning.family.find((m) => m.id === 'brother')?.status).toBe('well');
  const levy: RunSave = {
    ...save,
    mornings: [...save.mornings.slice(0, -1), { ...morning, flags: { ...morning.flags, ulf_home: 1, ulf_levy: 1 } }],
  };
  await page.addInitScript(
    (record) => {
      if (localStorage.getItem('cots.campaign.0') === null) localStorage.setItem('cots.campaign.0', record);
    },
    JSON.stringify({ v: 1, rev: 1, savedAt: 0, save: levy }),
  );
  await page.goto('./');
  await page.getByTestId('play-campaign').click();
  await page.getByTestId('continue-0').click();
  await expect(page.getByTestId('morning-title')).toHaveText('Day 16');

  // Over the pass at first light: the men to choose from, your brother among them.
  const scene = page.getByTestId('scene');
  await expect(scene).toContainText('Hákon, at Fitjar');
  await expect(scene).toContainText('Your brother, three shields down.');
  await expect(page.getByTestId('scene-choice')).toHaveText(['Kari.', 'Ulf.', 'Aslak.', "I won't choose."]);
  await expectAccessible(page);
  await page
    .getByTestId('scene-choice')
    .filter({ hasText: /^Ulf\.$/ })
    .click();
  await expect(scene).toContainText('Odin will know what that cost');
  // What it did, under the line that did it: Odin's notice, and the house one fewer before the night shows it.
  await expect(page.getByTestId('scene-note')).toHaveText(['Odin will remember that (+2).']);
  await expect(page.getByTestId('scene-family-note')).toHaveText(['Ulf, your brother: died.']);
  await expectAccessible(page);
  await expect(scene).toContainText('"Liars," says Skögul');
  await page.getByTestId('scene-done').click();
  await page.getByTestId('to-gate').click();

  // He stands in the line where Solveig's boy would have, and Kari isn't in it.
  const queue = await page.evaluate<CaseSpec[]>(
    `JSON.parse(localStorage.getItem('cots.campaign.0') ?? 'null')?.save.queue ?? []`,
  );
  const at = queue.findIndex((c) => c.script === 'case.ulf16');
  expect(at).toBe(2);
  expect(queue.some((c) => c.script === 'case.kari')).toBe(false);
  for (const [i, c] of queue.entries()) {
    if (i === at) {
      if (await isDrawer(page)) await page.locator('[data-tab="words"]').click();
      await expect(page.locator('.words__who')).toHaveText('Ulf Rögnuson');
      await expect(page.locator('.words')).toContainText('So that was you up on the ridge, on the grey.');
      await expect(page.getByTestId('plea-banner')).toHaveCount(0);
      await expectAccessible(page);
    }
    await stampAndSend(page, c);
  }
  await expect(page.getByTestId('audit-score')).toHaveText(`${queue.length} of ${queue.length} judged rightly`);
  await page.getByTestId('go-home').click();

  // Nobody at home writes in his hand now; Skögul says nothing, and puts a cup by you.
  await expect(page.getByTestId('night-title')).toHaveText('Night 16');
  await expect(page.getByTestId('scene')).toContainText("Ulf didn't come down from the pass.");
  await expect(page.getByTestId('scene')).toContainText('second cup');
  await playScenes(page);
  await expect(page.getByTestId('family').locator('[data-member="brother"]')).toContainText('died');
});
