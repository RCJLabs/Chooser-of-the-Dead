import AxeBuilder from '@axe-core/playwright';
import { ENGINE_MAJOR, type RunSave } from '@cots/engine';
import { loadContent, scenarioSave } from '@cots/testkit';
import { expect, type Page, test } from '@playwright/test';
import { BASE, FULL } from './urls';

/*
 * Who she was in life (docs/tech-spec.md §72), in the full game:
 * - A new run's slot asks who she was, folded under its choice: nobody in particular (the household as it always
 *   was), or one of the origins, each with what it gives and who it brings home. A run begun as one says so on its slot and its mornings, and
 *   starts with its rings and one more at home.
 * - On the first night, after the family's letter, the origin's own scene: Thurid's note. She's in the family list,
 *   off the food bill while she's well, so it still feeds three.
 * - The demo asks nothing.
 */

test.use({ baseURL: FULL });

const content = loadContent('dev-full');
const startRings = content.campaign?.startRings ?? 0;
const shieldmaiden = content.campaign?.origins?.find((o) => o.id === 'shieldmaiden');

async function expectAccessible(page: Page) {
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
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

test('a new run asks who she was, and one begun as the shieldmaiden says so, with Thurid at home', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('play-campaign').click();
  // Folded, saying the choice: nobody in particular unless she says otherwise, the household as it always was.
  const summary = page.getByTestId('origins-0').locator('summary');
  await expect(summary).toHaveText('Who were you? Nobody in particular');
  await summary.click();
  const picker = page.getByTestId('slot-0').getByRole('group', { name: 'Who were you?' });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('radio')).toHaveCount(1 + (content.campaign?.origins?.length ?? 0));
  await expect(page.getByTestId('origin-none-0')).toBeChecked();
  const card = page.locator('label.origin', { has: page.getByTestId('origin-shieldmaiden-0') });
  await expect(card).toContainText('The shieldmaiden');
  await expect(card).toContainText('Turn over costs no sun.');
  await expect(card).toContainText('Feather costs 4 seconds of sun.');
  await expect(card).toContainText(
    'At home besides the family: Thurid, your shield-sister. Off the food bill while well; sick, one more to feed.',
  );
  const trader = page.locator('label.origin', { has: page.getByTestId('origin-trader-0') });
  await expect(trader).toContainText('30 rings more to start with.');
  await expect(trader).toContainText("The quartermaster's upgrades cost you 15% less.");
  // Every choice is a tap target a thumb can hit.
  for (const label of await picker.locator('label.origin').all()) {
    expect((await label.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  expect((await summary.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await page.getByTestId('origin-shieldmaiden-0').check();
  await expect(summary).toHaveText('Who were you? The shieldmaiden');
  await expectAccessible(page);

  // The vertical slice is played as it always was: no origin to choose.
  await page.getByTestId('start-play-0').check();
  await expect(page.getByTestId('origins-0')).toHaveCount(0);
  await page.getByTestId('start-campaign-0').check();
  await expect(summary).toHaveText('Who were you? The shieldmaiden');

  await page.getByTestId('new-0').click();
  await expect(page.getByTestId('morning-title')).toHaveText('Day 1');
  await expect(page.getByTestId('origin-name')).toContainText('The shieldmaiden');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('cots.campaign.0') ?? 'null'));
  expect(saved?.save.mornings[0].origin).toBe('shieldmaiden');
  expect(saved?.save.mornings[0].rings).toBe(startRings + (shieldmaiden?.perk.startRings ?? 0));
  await page.getByTestId('campaign-quit').click();
  const slot = page.getByTestId('slot-0').getByTestId('slot-summary');
  await expect(slot).toContainText('4 of 4 at home');
  await expect(slot).toContainText('The shieldmaiden');
});

test('the first night: the family’s letter, then Thurid’s, and she keeps herself', async ({ page }) => {
  await load(page, scenarioSave(content, 'e2e-origin-0', 1, ENGINE_MAJOR, 'night', { origin: 'shieldmaiden' }));
  await expect(page.getByTestId('night-title')).toHaveText('Night 1');
  const scene = page.getByTestId('scene');
  await expect(scene).toContainText("Your brother's hand");
  while ((await page.getByTestId('scene-done').count()) === 0) await page.getByTestId('scene-choice').first().click();
  await page.getByTestId('scene-done').click();

  // Her note comes after the family's letter, as a scene of its own.
  await expect(scene).toContainText('THURID. Your brother writes too much.');
  await page.getByTestId('scene-choice').filter({ hasText: 'Ask her to keep them safe.' }).click();
  await expect(scene).toContainText('keep them warm, keep them fed, keep them');
  await expectAccessible(page);
  await page.getByTestId('scene-done').click();
  await expect(scene).toHaveCount(0);

  await expect(page.getByTestId('family').locator('[data-member="thurid"]')).toHaveText(
    'Thurid, your shield-sister: well, and off the food bill',
  );
  await expect(page.getByTestId('bills')).toContainText('Food for 3');
  await expectAccessible(page);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('cots.campaign.0') ?? 'null'));
  expect(saved?.save.log.filter((a: { t: string }) => a.t === 'scene').map((a: { id: string }) => a.id)).toEqual([
    'scene.d1.night',
    'scene.o.shieldmaiden.1',
  ]);
});

test('the demo asks nothing about who she was', async ({ page }) => {
  await page.goto(BASE);
  await page.getByTestId('play-campaign').click();
  await expect(page.getByTestId('slot-0')).toBeVisible();
  await expect(page.getByTestId('origins-0')).toHaveCount(0);
});
